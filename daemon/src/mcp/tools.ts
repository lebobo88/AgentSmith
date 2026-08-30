import { z } from "zod";
import type { ToolMap, ToolDefinition } from "./server.js";
import type { AgentSmithConfig } from "../config.js";
import { Inspector } from "../inspector/index.js";
import { Factory } from "../factory/index.js";
import { Watcher, Classifier, ReplicationController, SIGNATURES } from "../sentinel/index.js";
import { Isolator } from "../quarantine/index.js";
import { Registry, analyzeGaps } from "../keymaker/index.js";
import { evaluate as oracleEvaluate, promote as oraclePromote } from "../oracle/index.js";
import { DecisionStore, buildAudit } from "../archivist/index.js";
import { EightsBridge, HydraBridge, PpBridge, ConsumerBridge } from "../bridges/index.js";
import { ArtifactKindSchema, ConsumerProjectSchema } from "../schemas/artifact.js";
import type { SmithVerdict } from "../schemas/verdict.js";
import type { N8AttestationController } from "../n8-attestation.js";

/**
 * AS-GV-2: Venom guard — shared N2 enforcement helper.
 *
 * Calls venomCrossCheck and returns { allowed, rationale }. Returns
 * allowed=false (CLOSED) on ANY of:
 *   - ok !== true (merits-deny from Hydra)
 *   - degraded / unreachable (fail-closed per AS-GV-3)
 *   - any exception from the call
 *
 * Apply this to every capability/commit path before committing or proposing.
 * A non-allowed result MUST short-circuit to a rejected ticket.
 */
async function venomGuard(
  kernel: SmithKernel,
  capability: string,
  args: unknown,
): Promise<{ allowed: boolean; rationale: string }> {
  try {
    const r = await kernel.hydra.venomCrossCheck(capability, args);
    // Strict: allowed only when ok is EXACTLY true (not truthy, not missing).
    const allowed = r.ok === true;
    return { allowed, rationale: r.rationale };
  } catch (err) {
    // Any exception → fail closed.
    return { allowed: false, rationale: `N2: venom guard threw (fail CLOSED): ${String(err)}` };
  }
}

/**
 * AS-GV-1/3: Inspector gate — shared helper for promote and evolution_propose.
 *
 * Runs inspector.inspect. Returns the verdict. Callers MUST short-circuit
 * unless verdict.outcome === "allow" exactly. escalate/modify/deny all block.
 */
async function inspectorGate(kernel: SmithKernel, input: {
  kind: string;
  content: string;
  project?: string;
  path?: string;
  id?: string;
}): Promise<SmithVerdict> {
  return kernel.inspector.inspect(input as any);
}

export interface SmithKernel {
  cfg: AgentSmithConfig;
  inspector: Inspector;
  factory: Factory;
  watcher: Watcher;
  classifier: Classifier;
  replication: ReplicationController;
  isolator: Isolator;
  registry: Registry;
  decisions: DecisionStore;
  eights: EightsBridge;
  hydra: HydraBridge;
  pp: PpBridge;
  consumer: ConsumerBridge;
  attestation?: N8AttestationController;
}

export function registerTools(kernel: SmithKernel): ToolMap {
  const tools: ToolDefinition[] = [
    {
      name: "agentsmith.factory.scaffold",
      description: "Scaffold a candidate artifact (agent|skill|command|hook|team|squad|rubric|mcp).",
      inputSchema: z.object({
        kind: ArtifactKindSchema,
        slug: z.string(),
        project: ConsumerProjectSchema,
        options: z.record(z.unknown()).optional(),
      }),
      handler: async (args) => {
        const a = args as { kind: any; slug: string; project: any; options?: Record<string, unknown> };
        return kernel.factory.scaffold({ kind: a.kind, slug: a.slug, project: a.project, options: a.options });
      },
    },
    {
      name: "agentsmith.inspector.inspect",
      description: "Run schema + invariant + policy validators on an artifact draft or path content.",
      inputSchema: z.object({
        kind: ArtifactKindSchema,
        content: z.string(),
        path: z.string().optional(),
        id: z.string().optional(),
        project: ConsumerProjectSchema.optional(),
      }),
      handler: async (args) => kernel.inspector.inspect(args as any),
    },
    {
      name: "agentsmith.inspector.invariants_list",
      description: "List the active Smith invariants (frozen, hash-bound).",
      inputSchema: z.object({}),
      handler: async () => ({
        constitution_sha256: kernel.inspector.constitutionHash(),
        invariants: kernel.inspector.invariants(),
      }),
    },
    {
      name: "agentsmith.constitution.get",
      description: "Get the active Smith constitution snapshot (text + sha256 + invariants).",
      inputSchema: z.object({}),
      handler: async () => ({
        sha256: kernel.inspector.constitutionHash(),
        invariants: kernel.inspector.invariants(),
      }),
    },
    {
      name: "agentsmith.constitution.attest",
      description:
        "Emit an attestation receipt binding a workflow to AgentSmith's own constitution hash. Refuses if a non-agentsmith consumer is requested.",
      inputSchema: z.object({
        workflow_id: z.string(),
        consumer: z.literal("agentsmith").optional(),
      }),
      handler: async (args) => {
        const a = args as {
          workflow_id: string;
          consumer?: "agentsmith";
        };
        // Hash is sourced internally by the bridge from the injected gate.constitutionHash().
        // The caller must not (and cannot) supply a localHash — the bridge parameter
        // was removed to prevent caller-override (Issue 2, pass-4 fix).
        return kernel.eights.constitutionAttest(a.workflow_id, a.consumer);
      },
    },
    {
      name: "agentsmith.constitution.propose_amendment",
      description: "Open a HITL ticket proposing an amendment to the Smith constitution.",
      inputSchema: z.object({ text: z.string(), rationale: z.string() }),
      handler: async (args) => {
        const a = args as { text: string; rationale: string };
        return kernel.eights.governanceHitlRequest({
          reason: "constitution_amendment",
          payload: { text: a.text, rationale: a.rationale },
        });
      },
    },
    {
      name: "agentsmith.constitution.reattest",
      description:
        "Re-run full TheEights constitution attestation in-process and lift N8 refusal if the hash verifies.",
      inputSchema: z.object({}),
      handler: async () => {
        if (!kernel.attestation) {
          return {
            ok: false,
            refused: true,
            reason: "N8: reattestation controller unavailable",
            detail: "boot attest controller missing",
          };
        }
        return kernel.attestation.reattest();
      },
    },
    {
      name: "agentsmith.replicator.spawn",
      description: "Spawn a Smith watcher clone for a given scope (N5: quota-bounded).",
      inputSchema: z.object({ scope: z.string(), reason: z.string() }),
      handler: async (args) => {
        const a = args as { scope: string; reason: string };
        return kernel.replication.spawn(a.scope, a.reason);
      },
    },
    {
      name: "agentsmith.replicator.teardown",
      description: "Tear down an active Smith watcher clone.",
      inputSchema: z.object({ clone_id: z.string() }),
      handler: async (args) => {
        const a = args as { clone_id: string };
        kernel.replication.teardown(a.clone_id);
        return { ok: true };
      },
    },
    {
      name: "agentsmith.replicator.list",
      description: "List active Smith clones.",
      inputSchema: z.object({}),
      handler: async () => ({ clones: kernel.replication.list() }),
    },
    {
      name: "agentsmith.sentinel.signatures_list",
      description: "List the loaded Smith anomaly signature library.",
      inputSchema: z.object({}),
      handler: async () => ({ signatures: SIGNATURES }),
    },
    {
      name: "agentsmith.sentinel.events_recent",
      description: "Return the most recent anomaly events from the watcher ring buffer.",
      inputSchema: z.object({ limit: z.number().int().positive().max(200).optional() }),
      handler: async (args) => {
        const a = args as { limit?: number };
        return { events: kernel.watcher.recent(a.limit) };
      },
    },
    {
      name: "agentsmith.sentinel.classify",
      description: "Classify an anomaly event against the loaded signature library.",
      inputSchema: z.object({
        event_id: z.string(),
        severity: z.enum(["info", "low", "medium", "high", "critical"]),
        source: z.string(),
        payload_summary: z.string(),
        observed_at: z.string(),
        scope: z.string().optional(),
      }),
      handler: async (args) => kernel.classifier.classify(args as any),
    },
    {
      name: "agentsmith.quarantine.isolate",
      description: "Isolate an entity (agent|skill|artifact|memory) and open a HITL release ticket.",
      inputSchema: z.object({ entity_id: z.string(), reason: z.string(), payload: z.string().optional() }),
      handler: async (args) => {
        const a = args as { entity_id: string; reason: string; payload?: string };
        const ticket = kernel.isolator.isolate(a.entity_id, a.reason, a.payload);
        const hitl = await kernel.eights.governanceHitlRequest({
          reason: "quarantine_release_review",
          payload: ticket,
        });
        return { ...ticket, hitl_ticket_id: hitl.request_id };
      },
    },
    {
      name: "agentsmith.quarantine.release",
      description: "Release or purge a quarantined entity after HITL decision.",
      inputSchema: z.object({ ticket_id: z.string(), decision: z.enum(["release", "purge"]) }),
      handler: async (args) => {
        const a = args as { ticket_id: string; decision: "release" | "purge" };
        return kernel.isolator.release(a.ticket_id, a.decision);
      },
    },
    {
      name: "agentsmith.quarantine.list",
      description: "List persisted quarantine tickets without exposing quarantined payloads.",
      inputSchema: z.object({}),
      handler: async () => kernel.isolator.list(),
    },
    {
      name: "agentsmith.keymaker.scan",
      description: "Scan one or all consumer projects for installed agents/skills/commands/hooks/teams/squads/rubrics.",
      inputSchema: z.object({ project: ConsumerProjectSchema.optional() }),
      handler: async (args) => {
        const a = args as { project?: any };
        const snap = kernel.registry.scan(a.project);
        kernel.registry.writeCache(snap);
        return snap;
      },
    },
    {
      name: "agentsmith.keymaker.gap_report",
      description: "Surface missing artifacts per project profile.",
      inputSchema: z.object({ project: ConsumerProjectSchema.optional() }),
      handler: async (args) => {
        const a = args as { project?: any };
        const snap = kernel.registry.readCache() ?? kernel.registry.scan(a.project);
        return { missing: analyzeGaps(snap, a.project) };
      },
    },
    {
      name: "agentsmith.oracle.evaluate",
      description: "Evaluate a candidate artifact against named Smith rubrics.",
      inputSchema: z.object({
        draft: z.record(z.unknown()),
        rubric_ids: z.array(z.string()),
      }),
      handler: async (args) => {
        const a = args as { draft: any; rubric_ids: string[] };
        return oracleEvaluate(a.draft, a.rubric_ids);
      },
    },
    {
      name: "agentsmith.factory.promote",
      description: "Promote a passing draft via TheEights evolution.propose (auto-commit if low-risk). Inspector runs first (N7 — must return 'allow'); venomGuard runs second (N2 — venom unreachable fails closed). Any non-allow Inspector outcome or a blocked venom gate short-circuits before any oracle call.",
      inputSchema: z.object({ draft: z.record(z.unknown()), rubric_ids: z.array(z.string()) }),
      handler: async (args) => {
        const a = args as { draft: Record<string, unknown>; rubric_ids: string[] };
        const inspectKind = (a.draft["kind"] as any) ?? "agent";
        const inspectContent = typeof a.draft["content"] === "string" ? a.draft["content"] : JSON.stringify(a.draft);
        const inspectProject = (a.draft["project"] as any) ?? undefined;
        const inspectPath = typeof a.draft["target_path"] === "string" ? a.draft["target_path"] : undefined;
        const inspectId = typeof a.draft["draft_id"] === "string" ? a.draft["draft_id"] : undefined;

        // AS-GV-1/3: Inspector gate. MUST return "allow" exactly — escalate/modify/deny all block.
        const verdict = await inspectorGate(kernel, {
          kind: inspectKind,
          content: inspectContent,
          project: inspectProject,
          path: inspectPath,
          id: inspectId,
        });
        if (verdict.outcome !== "allow") {
          return {
            ticket_id: `promo_${inspectId ?? "unknown"}_inspector_${verdict.outcome}`,
            draft_id: inspectId ?? "unknown",
            status: "rejected",
            rationale: `Inspector gate blocked (outcome=${verdict.outcome}): ${verdict.rationale} [cited: ${verdict.cited_invariants.join(", ")}]`,
            inspector_verdict: verdict,
          };
        }

        // AS-GV-2: N2 venom guard. venomCrossCheck unreachable → allowed=false (fail CLOSED).
        const venom = await venomGuard(kernel, `agentsmith.factory.promote:${inspectKind}`, a.draft);
        if (!venom.allowed) {
          return {
            ticket_id: `promo_${inspectId ?? "unknown"}_venom_blocked`,
            draft_id: inspectId ?? "unknown",
            status: "rejected",
            rationale: `N2 venom gate blocked: ${venom.rationale}`,
          };
        }

        const report = await oracleEvaluate(a.draft, a.rubric_ids);
        return oraclePromote(a.draft, report, kernel.eights);
      },
    },
    {
      name: "agentsmith.archivist.audit",
      description: "Generate a cross-system audit report from Smith decisions plus linked traces.",
      inputSchema: z.object({ workflow_id: z.string().optional(), trace_id: z.string().optional() }),
      handler: async (args) => {
        const a = args as { workflow_id?: string; trace_id?: string };
        const decisions = kernel.decisions.list();
        return buildAudit(a, decisions, { eightsBridge: kernel.eights });
      },
    },
    {
      name: "agentsmith.archivist.decisions",
      description: "List Smith decision records with optional filters.",
      inputSchema: z.object({
        actor: z.string().optional(),
        outcome: z.enum(["allow", "deny", "modify", "escalate"]).optional(),
        limit: z.number().int().positive().optional(),
      }),
      handler: async (args) => ({ decisions: kernel.decisions.list(args as any) }),
    },
    {
      name: "agentsmith.archivist.seal",
      description: "Seal a new SmithDecisionRecord into the append-only ledger.",
      inputSchema: z.object({
        actor: z.string(),
        subject_kind: z.string(),
        subject_id: z.string(),
        verdict: z.object({
          outcome: z.enum(["allow", "deny", "modify", "escalate"]),
          rationale: z.string(),
          cited_invariants: z.array(z.string()).default([]),
          suggested_fix: z.string().optional(),
          escalation_target: z.string().optional(),
          evidence: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
          decided_at: z.string(),
        }),
        workflow_id: z.string().optional(),
        trace_id: z.string().optional(),
        audit_links: z.array(z.string()).optional(),
      }),
      handler: async (args) => kernel.decisions.seal(args as any),
    },
    // --- Bridge proxy tools (Phase 2: real MCP clients into siblings) -----
    {
      name: "agentsmith.eights.memory_add",
      description: "Add a memory item to TheEights' memory store (eights.memory.add).",
      inputSchema: z.object({
        type: z.string(),
        content: z.string(),
        cell: z.string().optional(),
        scopes: z.array(z.string()).optional(),
      }),
      handler: async (args) => {
        const a = args as { type: string; content: string; cell?: string; scopes?: string[] };
        return kernel.eights.memoryAdd(a);
      },
    },
    {
      name: "agentsmith.eights.evolution_propose",
      description: "Propose an evolution of a resource via TheEights (eights.evolution.propose). Inspector gate (N7 — must allow) and N2 venom guard run before proposing; a non-allow verdict or blocked venom gate rejects without calling TheEights.",
      inputSchema: z.object({
        rid: z.string(),
        candidate_content: z.string(),
        justification: z.string(),
        evidence_memory_ids: z.array(z.string()).optional(),
      }),
      handler: async (args) => {
        const a = args as {
          rid: string;
          candidate_content: string;
          justification: string;
          evidence_memory_ids?: string[];
        };

        // AS-GV-4: Inspector gate on the candidate_content. Use kind="agent" as the
        // default artifact kind for raw evolution proposals (the caller should ideally
        // pass a kind field; we treat the content as an opaque artifact for schema check).
        // Require "allow" exactly — escalate/modify/deny all block (AS-GV-3).
        const verdict = await inspectorGate(kernel, {
          kind: "agent",
          content: a.candidate_content,
          id: a.rid,
        });
        if (verdict.outcome !== "allow") {
          return {
            ok: false,
            status: "rejected",
            rationale: `Inspector gate blocked (outcome=${verdict.outcome}): ${verdict.rationale} [cited: ${verdict.cited_invariants.join(", ")}]`,
            inspector_verdict: verdict,
            proposal_id: undefined,
          };
        }

        // AS-GV-2: N2 venom guard before committing to TheEights.
        // Issue 1 fix: include candidate_content in the args so the cross-check is meaningful.
        const venom = await venomGuard(kernel, `agentsmith.eights.evolution_propose:${a.rid}`, { rid: a.rid, justification: a.justification, candidate_content: a.candidate_content });
        if (!venom.allowed) {
          return {
            ok: false,
            status: "rejected",
            rationale: `N2 venom gate blocked: ${venom.rationale}`,
            proposal_id: undefined,
          };
        }

        return kernel.eights.evolutionPropose(a);
      },
    },
    {
      name: "agentsmith.eights.hitl_request",
      description: "Open a HITL request via TheEights governance (eights.governance.hitl.request).",
      inputSchema: z.object({
        reason: z.string(),
        payload: z.unknown(),
      }),
      handler: async (args) => {
        const a = args as { reason: string; payload: unknown };
        return kernel.eights.governanceHitlRequest(a);
      },
    },
    {
      name: "agentsmith.eights.lookup_envelope_attempt",
      description:
        "R3-tail post-mortem Fix 2.3: look up an envelope/attempt id in TheEights' shared ledger before declaring it 'not found'. Returns {found: boolean, via_kinds: []}. Use this from smith-archivist seal flows that need to confirm a Hydra-originated envelope exists in the shared ledger before sealing — R3-tail DR-2026-018 was deferred because this path didn't exist and the local ledger didn't know about Hydra's envelopes.",
      inputSchema: z.object({
        attempt_id: z.string(),
      }),
      handler: async (args) => {
        const a = args as { attempt_id: string };
        return kernel.eights.lookupEnvelopeAttempt(a.attempt_id);
      },
    },
    {
      name: "agentsmith.hydra.squad_list",
      description: "List Hydra squads via the Hydra bridge (hydra.squad.list).",
      inputSchema: z.object({}),
      handler: async () => ({ squads: await kernel.hydra.squadRegistry() }),
    },
    {
      name: "agentsmith.hydra.venom_cross_check",
      description: "Ask Hydra's Venom to cross-check a capability invocation.",
      inputSchema: z.object({
        capability: z.string(),
        args: z.unknown().optional(),
      }),
      handler: async (args) => {
        const a = args as { capability: string; args?: unknown };
        return kernel.hydra.venomCrossCheck(a.capability, a.args ?? {});
      },
    },
    {
      name: "agentsmith.pp.best_of_start",
      description: "Start a pair-programmer best-of-N stage (start_best_of_stage).",
      inputSchema: z.object({
        run_id: z.string(),
        stage_id: z.string(),
        prompt: z.string(),
        n: z.number().int().positive(),
      }),
      handler: async (args) => {
        const a = args as { run_id: string; stage_id: string; prompt: string; n: number };
        return kernel.pp.startBestOfStage(a);
      },
    },
    {
      name: "agentsmith.pp.borda_count",
      description: "Run Borda-count winner selection over candidates (borda_count).",
      inputSchema: z.object({
        candidate_ids: z.array(z.string()),
        rubric_ids: z.array(z.string()),
      }),
      handler: async (args) => {
        const a = args as { candidate_ids: string[]; rubric_ids: string[] };
        return kernel.pp.bordaCount(a.candidate_ids, a.rubric_ids);
      },
    },
  ];

  const map: ToolMap = new Map();
  for (const t of tools) map.set(t.name, t);
  return map;
}

/**
 * AS-GV-2 (fix 5): Build an N8-refusal tool map by WRAPPING the real tool set.
 *
 * Calls `registerTools(kernel)` to get the real ToolMap, then maps over every
 * entry, keeping the real `name` and `inputSchema` but replacing each `handler`
 * with a refusal closure. This guarantees exact name-set equality with the real
 * tool map — no hand-maintained list that can drift.
 *
 * Used when the daemon boots but constitution attestation fails (mismatch,
 * refused, or eights unreachable). The MCP server still answers `initialize`
 * so the gateway doesn't time out, but every tool call returns the N8 refusal
 * envelope.
 */
export function buildN8RefusalTools(kernel: SmithKernel, getAttestDetail: () => string): ToolMap {
  const realTools = registerTools(kernel);
  const refusalMap: ToolMap = new Map();
  for (const [name, real] of realTools) {
    if (name === "agentsmith.constitution.reattest") {
      refusalMap.set(name, real);
      continue;
    }
    refusalMap.set(name, {
      name,
      description: `[N8-REFUSAL] ${name} is unavailable: constitution unattested.`,
      // Keep real inputSchema so ListTools reports correct parameter shapes.
      inputSchema: real.inputSchema,
      handler: async (_args) => ({
        ok: false,
        refused: true,
        reason: "N8: constitution unattested/mismatch — tools refused",
        detail: getAttestDetail(),
      }),
    });
  }
  return refusalMap;
}
