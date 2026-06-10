/**
 * EightsBridge — real MCP client to TheEights' daemon.
 *
 * Spawns `node <TheEights>/daemon/dist/index.js` as a child process and calls
 * its `eights.*` MCP tools. Every method is degraded-by-default: if the bridge
 * isn't reachable, callers get a marker object back instead of an exception.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpClient, type BridgeLogger, type McpServerConfig } from "./mcp-client.js";

/**
 * Sink-gate references injected into EightsBridge at construction time.
 *
 * These let the bridge enforce governance at the send-side sink so NO caller
 * (MCP handler, oracle/promotion.ts, spool replay) can bypass the gate.
 *
 * - `inspectContent(content)` — runs inspector.inspect on candidate_content;
 *   returns outcome ("allow"|"deny"|"escalate"|"modify") + rationale.
 * - `venomCheck(capability, args)` — calls hydra.venomCrossCheck; returns
 *   ok===true only on a strict boolean true (not coerced).
 * - `constitutionHash()` — returns the current local constitution hex hash;
 *   compared against the boot-attested hash on every gated op (TOCTOU fix).
 * - `bootAttestedHash` — the hash that was verified at boot; stored here so
 *   the sink can compare recomputed hashes against it.
 */
export interface SinkGateRefs {
  inspectContent: (content: string, id?: string) => Promise<{ outcome: string; rationale: string; cited_invariants: string[] }>;
  venomCheck: (capability: string, args: unknown) => Promise<{ ok: boolean; rationale: string }>;
  constitutionHash: () => string;
  bootAttestedHash: string;
}

export interface EightsBridgeOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  logger?: BridgeLogger;
  /** Override the on-disk spool dir. Defaults to ~/.agentsmith/eights-pending. */
  spoolDir?: string;
  /**
   * Sink-gate refs. When provided, evolutionPropose, evolutionCommit, and
   * replayPendingProposals enforce inspector + venom + N8-TOCTOU checks before
   * any network call to TheEights. When absent (tests that don't need gating),
   * gating is skipped — the MCP handler layer is then responsible.
   */
  gate?: SinkGateRefs;
}

const DEFAULT_EIGHTS_ENTRY = "C:/AiAppDeployments/TheEights/daemon/dist/index.js";

/**
 * Payload shape persisted to disk in the eights-pending spool.
 *
 * `args` is the original `evolutionPropose` input so replay can re-issue the
 * exact same MCP call. `spooled_at` is set by the bridge on failure.
 */
interface SpooledProposal {
  id: string;
  tool: "eights.evolution.propose";
  args: {
    rid: string;
    candidate_content: string;
    justification: string;
    evidence_memory_ids?: string[];
  };
  spooled_at: string;
  reason: string;
}

/** Summary returned by replayPendingProposals(). */
export interface ReplaySummary {
  sent: number;
  failed: number;
  skipped: number;
}

export interface DegradedMarker {
  degraded: true;
  reason: string;
}

/**
 * Result of constitutionAttest. `receipt_id`/`hash` are retained as back-compat
 * aliases (receipt_id = receipt_signature, hash = constitution content hash);
 * `receipt_signature` is the canonical value a supervisor binds to its run
 * state per the workflow-intake attestation contract.
 */
export interface AttestReceipt {
  receipt_id: string;
  hash: string;
  receipt_signature?: string;
  consumer?: string;
  version?: string;
  content_hash?: string;
  attested_at?: string;
  trace_id?: string;
}

function degraded<T extends Record<string, unknown>>(extra: T, reason: string): T & DegradedMarker {
  return { ...extra, degraded: true, reason };
}

/** The five consumers whose constitutions/resources TheEights governs. */
type EightsConsumer = "eights" | "pp" | "hydra" | "execsuite" | "rlm";

/**
 * Consumer whose constitution AgentSmith binds a workflow to when attesting.
 * Defaults to "hydra" — the orchestrator's frozen Immortal Head. The "eights"
 * consumer has no constitution registered, so attesting against it always
 * refuses; attesting a Hydra-orchestrated workflow against the hydra
 * constitution is the semantically correct binding.
 */
const DEFAULT_ATTEST_CONSUMER: EightsConsumer = "hydra";

/**
 * AgentSmith's fixed read/propose Envelope for every governed eights MCP call.
 *
 * TheEights enforces an `Envelope` at every handler boundary (see
 * `daemon/src/schemas/envelope.ts`). The bridge previously omitted it, so every
 * governed call (constitution.attest, memory.add/search, evolution.propose/commit,
 * governance.hitl.*) failed Zod validation and silently degraded to an
 * all-zeros / "eights-mcp-unavailable" marker. The envelope is fixed and never
 * broadens scope (empty `scope`), consistent with AGENTS.md "read and propose
 * only". `trace_id` carries the workflow id when one is supplied so receipts and
 * audit events bind to the originating workflow.
 */
function smithEnvelope(traceId?: string): Record<string, unknown> {
  return {
    tenant_id: "local",
    actor_id: "agentsmith",
    project_id: "TheEights",
    domain: "governance",
    scope: [],
    trace_id: traceId ?? `smith_${randomUUID()}`,
  };
}

export class EightsBridge {
  private readonly client: McpClient;
  private readonly log: BridgeLogger;
  private readonly spoolDir: string;
  private readonly gate: SinkGateRefs | undefined;

  constructor(opts: EightsBridgeOptions = {}) {
    const command = opts.command ?? "node";
    const args =
      opts.args ??
      (existsSync(DEFAULT_EIGHTS_ENTRY) ? [DEFAULT_EIGHTS_ENTRY] : [DEFAULT_EIGHTS_ENTRY]);
    const cfg: McpServerConfig = {
      name: "eights",
      command,
      args,
      ...(opts.env ? { env: opts.env } : {}),
    };
    this.log =
      opts.logger ??
      ({
        warn: (o, m) => console.error("[eights-bridge] WARN", m ?? "", JSON.stringify(o)),
        error: (o, m) => console.error("[eights-bridge] ERROR", m ?? "", JSON.stringify(o)),
      } satisfies BridgeLogger);
    this.client = new McpClient(cfg, this.log);
    this.spoolDir = opts.spoolDir ?? join(homedir(), ".agentsmith", "eights-pending");
    this.gate = opts.gate;
  }

  /**
   * Sink-level governance gate. Called by evolutionPropose, evolutionCommit,
   * and replayPendingProposals BEFORE any network call to TheEights.
   *
   * Three checks in order:
   *   1. N8 TOCTOU: recompute constitutionHash(); must === bootAttestedHash.
   *   2. Inspector: candidate_content must get outcome==="allow" exactly.
   *   3. Venom (N2): venomCheck must return ok===true strictly.
   *
   * Returns { blocked: false } on pass; { blocked: true, reason } on any failure.
   * FAIL CLOSED: if no gate is configured, propose/commit/replay are DENIED.
   * There is no legitimate reason to reach TheEights mutating ops without a gate.
   */
  private async _runSinkGate(
    candidate_content: string,
    rid: string,
    venomCapability: string,
  ): Promise<{ blocked: false } | { blocked: true; reason: string }> {
    if (!this.gate) {
      return {
        blocked: true,
        reason: "N2/N7 sink gate not configured — failing closed (no gate injected at construction)",
      };
    }

    // 1. N8 TOCTOU — recompute local constitution hash and compare to boot-attested.
    let currentHash: string;
    try {
      currentHash = this.gate.constitutionHash();
    } catch (err) {
      return { blocked: true, reason: `N8: constitutionHash() threw at sink — ${String(err)}` };
    }
    if (currentHash !== this.gate.bootAttestedHash) {
      this.log.warn(
        { current: currentHash, boot: this.gate.bootAttestedHash },
        "N8 TOCTOU: constitution hash drifted since boot — blocking propose/commit",
      );
      return { blocked: true, reason: `N8: constitution hash drifted since boot (TOCTOU)` };
    }

    // 2. Inspector gate — require outcome === "allow" exactly.
    let verdict: { outcome: string; rationale: string; cited_invariants: string[] };
    try {
      verdict = await this.gate.inspectContent(candidate_content, rid);
    } catch (err) {
      return { blocked: true, reason: `Inspector threw at sink — ${String(err)}` };
    }
    if (verdict.outcome !== "allow") {
      this.log.warn(
        { outcome: verdict.outcome, rationale: verdict.rationale, rid },
        "sink gate: Inspector blocked propose/commit",
      );
      return {
        blocked: true,
        reason: `Inspector blocked (outcome=${verdict.outcome}): ${verdict.rationale} [${verdict.cited_invariants.join(", ")}]`,
      };
    }

    // 3. N2 Venom guard — venomCheck ok must be === true strictly.
    let venomResult: { ok: boolean; rationale: string };
    try {
      venomResult = await this.gate.venomCheck(venomCapability, { rid, candidate_content });
    } catch (err) {
      return { blocked: true, reason: `N2: venom threw at sink (fail CLOSED) — ${String(err)}` };
    }
    if (venomResult.ok !== true) {
      this.log.warn(
        { ok: venomResult.ok, rationale: venomResult.rationale, rid },
        "sink gate: venom blocked propose/commit (N2)",
      );
      return { blocked: true, reason: `N2: venom blocked: ${venomResult.rationale}` };
    }

    return { blocked: false };
  }

  /**
   * Persist a failed eights.evolution.propose payload to the on-disk spool.
   * Atomic write: stage to `<uuid>.json.partial` then rename to `<uuid>.json`.
   * Fail-soft: any write error is logged and swallowed (the in-memory
   * degraded marker is still returned to the caller).
   */
  private spoolProposal(
    args: SpooledProposal["args"],
    reason: string,
  ): { spooled: true; id: string } | { spooled: false } {
    try {
      mkdirSync(this.spoolDir, { recursive: true });
      const id = randomUUID();
      const payload: SpooledProposal = {
        id,
        tool: "eights.evolution.propose",
        args,
        spooled_at: new Date().toISOString(),
        reason,
      };
      const finalPath = join(this.spoolDir, `${id}.json`);
      const partialPath = `${finalPath}.partial`;
      writeFileSync(partialPath, JSON.stringify(payload, null, 2), "utf8");
      renameSync(partialPath, finalPath);
      this.log.warn(
        { spoolDir: this.spoolDir, id, reason },
        "spooled failed eights.evolution.propose for replay",
      );
      return { spooled: true, id };
    } catch (err) {
      this.log.error(
        { err: String(err), spoolDir: this.spoolDir },
        "failed to spool eights proposal — proposal will be lost",
      );
      return { spooled: false };
    }
  }

  /**
   * Drain the on-disk spool by re-issuing each pending proposal directly to
   * the MCP child-process boundary (`this.client.call`). Successful sends
   * delete the file; failures leave it for the next replay attempt; corrupt
   * files don't block draining the rest (they are counted as `skipped`).
   *
   * Returns a {sent, failed, skipped} summary. Never throws.
   */
  async replayPendingProposals(): Promise<ReplaySummary> {
    const summary: ReplaySummary = { sent: 0, failed: 0, skipped: 0 };
    let entries: string[];
    try {
      if (!existsSync(this.spoolDir)) return summary;
      entries = readdirSync(this.spoolDir).filter((f) => f.endsWith(".json"));
    } catch (err) {
      this.log.warn({ err: String(err), spoolDir: this.spoolDir }, "replay: readdir failed");
      return summary;
    }

    for (const fname of entries) {
      const fpath = join(this.spoolDir, fname);
      let parsed: SpooledProposal;
      try {
        const raw = readFileSync(fpath, "utf8");
        parsed = JSON.parse(raw) as SpooledProposal;
      } catch (err) {
        this.log.warn(
          { err: String(err), file: fpath },
          "replay: corrupt/unreadable spool file — skipping (left in place)",
        );
        summary.skipped += 1;
        continue;
      }
      // Sanity: only replay propose payloads we recognise.
      if (parsed.tool !== "eights.evolution.propose" || !parsed.args || !parsed.args.rid) {
        this.log.warn({ file: fpath }, "replay: unknown payload shape — skipping");
        summary.skipped += 1;
        continue;
      }

      // Sink gate: re-run governance on every replay entry before sending.
      // A mutable spool file could otherwise inject ungated proposals (Issue 2b).
      // Entries that fail the gate are dropped (unlinked) and counted as skipped.
      const gateResult = await this._runSinkGate(
        parsed.args.candidate_content,
        parsed.args.rid,
        `replay:${parsed.args.rid}`,
      );
      if (gateResult.blocked) {
        this.log.warn(
          { file: fpath, reason: gateResult.reason },
          "replay: sink gate blocked entry — dropping (not replaying)",
        );
        try { unlinkSync(fpath); } catch { /* best-effort */ }
        summary.skipped += 1;
        continue;
      }

      try {
        const r = await this.client.call<{ proposal_id?: string; auto_committed?: boolean; degraded?: unknown }>(
          "eights.evolution.propose",
          {
            envelope: smithEnvelope(),
            rid: parsed.args.rid,
            candidate_content: parsed.args.candidate_content,
            justification: parsed.args.justification,
            evidence_memory_ids: parsed.args.evidence_memory_ids ?? [],
          },
        );
        // A downstream degraded response is NOT a successful send — keep the file
        // for the next replay attempt (same as a transport failure).
        if (r.degraded === true) {
          this.log.warn(
            { file: fpath, r },
            "replay: downstream returned degraded — leaving for next attempt (not counted as sent)",
          );
          summary.failed += 1;
          continue;
        }
        try {
          unlinkSync(fpath);
        } catch (unlinkErr) {
          this.log.warn(
            { err: String(unlinkErr), file: fpath },
            "replay: send succeeded but unlink failed — may double-send on next replay",
          );
        }
        summary.sent += 1;
      } catch (err) {
        this.log.warn(
          { err: String(err), file: fpath },
          "replay: re-send failed — leaving for next attempt",
        );
        summary.failed += 1;
      }
    }
    return summary;
  }

  available(): Promise<boolean> {
    return this.client.available();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async memoryAdd(payload: {
    type: string;
    content: string;
    cell?: string;
    scopes?: string[];
  }): Promise<{ id: string } | (DegradedMarker & { id: string })> {
    try {
      const r = await this.client.call<{ id?: string }>("eights.memory.add", {
        envelope: smithEnvelope(),
        content: payload.content,
        type: payload.type,
        scopes: payload.scopes ?? [],
        cell: payload.cell,
        provenance: { actor: "agentsmith", source_uri: "agentsmith://bridge" },
      });
      return { id: r.id ?? "unknown" };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.memory.add" }, "degraded");
      return degraded({ id: "degraded" }, "eights-mcp-unavailable");
    }
  }

  async memorySearch(input: {
    query: string;
    type?: string;
    cell?: string;
    limit?: number;
  }): Promise<{ results: unknown[] } | (DegradedMarker & { results: unknown[] })> {
    try {
      const r = await this.client.call<{ results?: unknown[] }>("eights.memory.search", {
        envelope: smithEnvelope(),
        query: input.query,
        types: input.type ? [input.type] : undefined,
        top_k: input.limit ?? 10,
      });
      return { results: r.results ?? [] };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.memory.search" }, "degraded");
      return degraded({ results: [] as unknown[] }, "eights-mcp-unavailable");
    }
  }

  async evolutionPropose(input: {
    rid: string;
    candidate_content: string;
    justification: string;
    evidence_memory_ids?: string[];
  }): Promise<
    | { proposal_id: string; auto_committed: boolean }
    | (DegradedMarker & { proposal_id: string; auto_committed: boolean; spooled_id?: string })
  > {
    // Sink gate: inspector + venom + N8 TOCTOU before any network call.
    // This is the primary enforcement point — covers ALL callers (MCP handler,
    // oracle/promotion.ts, and any future caller) regardless of the call path.
    const gate = await this._runSinkGate(
      input.candidate_content,
      input.rid,
      `evolutionPropose:${input.rid}`,
    );
    if (gate.blocked) {
      this.log.warn({ rid: input.rid, reason: gate.reason }, "evolutionPropose: sink gate blocked");
      return degraded({ proposal_id: "gate-blocked", auto_committed: false }, gate.reason);
    }

    // Drain any prior degraded proposals first (fail-soft — never blocks the
    // new propose). The next successful propose effectively flushes the spool.
    // Each spool entry is independently gated inside replayPendingProposals.
    try {
      const summary = await this.replayPendingProposals();
      if (summary.sent > 0 || summary.failed > 0 || summary.skipped > 0) {
        this.log.warn(
          {
            sent: summary.sent,
            failed: summary.failed,
            skipped: summary.skipped,
          },
          "eights spool replay summary",
        );
      }
    } catch (err) {
      this.log.warn({ err: String(err) }, "spool replay threw — proceeding with new propose");
    }

    try {
      const r = await this.client.call<{ proposal_id?: string; auto_committed?: boolean; degraded?: unknown }>(
        "eights.evolution.propose",
        {
          envelope: smithEnvelope(),
          rid: input.rid,
          candidate_content: input.candidate_content,
          justification: input.justification,
          evidence_memory_ids: input.evidence_memory_ids ?? [],
        },
      );
      // Reject downstream degraded responses — a {degraded:true} body from TheEights
      // is NOT a successful propose; spool it for later retry.
      if (r.degraded === true) {
        this.log.warn({ rid: input.rid, r }, "evolutionPropose: downstream returned degraded — spooling");
        const spoolResult = this.spoolProposal(input, "eights-downstream-degraded");
        const base = degraded(
          { proposal_id: "degraded", auto_committed: false },
          "eights-downstream-degraded",
        );
        return spoolResult.spooled ? { ...base, spooled_id: spoolResult.id } : base;
      }
      return {
        proposal_id: r.proposal_id ?? "unknown",
        // Strict boolean: only literal true counts as auto-committed.
        // "false" (string), 1 (number), null, undefined all map to false.
        auto_committed: r.auto_committed === true,
      };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.evolution.propose" }, "degraded");
      const spoolResult = this.spoolProposal(input, "eights-mcp-unavailable");
      const base = degraded(
        { proposal_id: "degraded", auto_committed: false },
        "eights-mcp-unavailable",
      );
      return spoolResult.spooled ? { ...base, spooled_id: spoolResult.id } : base;
    }
  }

  async evolutionCommit(input: {
    proposal_id: string;
    approver?: string;
  }): Promise<{ committed: boolean } | (DegradedMarker & { committed: boolean })> {
    // Sink gate: commit is a write op; run N8 TOCTOU + venom before sending.
    // We use the proposal_id as both content and rid for the gate check
    // (commits don't carry candidate_content; N8+venom are still required).
    const gate = await this._runSinkGate(
      input.proposal_id,
      input.proposal_id,
      `evolutionCommit:${input.proposal_id}`,
    );
    if (gate.blocked) {
      this.log.warn({ proposal_id: input.proposal_id, reason: gate.reason }, "evolutionCommit: sink gate blocked");
      return degraded({ committed: false }, gate.reason);
    }

    try {
      const r = await this.client.call<{ committed?: boolean; degraded?: unknown }>("eights.evolution.commit", {
        envelope: smithEnvelope(),
        proposal_id: input.proposal_id,
      });
      // Reject downstream degraded responses — {degraded:true} body is NOT a successful commit.
      if (r.degraded === true) {
        this.log.warn({ proposal_id: input.proposal_id, r }, "evolutionCommit: downstream returned degraded — not committed");
        return degraded({ committed: false }, "eights-downstream-degraded");
      }
      // Strict boolean: only literal true counts as committed.
      return { committed: r.committed === true };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.evolution.commit" }, "degraded");
      return degraded({ committed: false }, "eights-mcp-unavailable");
    }
  }

  async governanceHitlRequest(input: {
    reason: string;
    payload: unknown;
  }): Promise<{ request_id: string } | (DegradedMarker & { request_id: string })> {
    try {
      const r = await this.client.call<{ request_id?: string }>(
        "eights.governance.hitl.request",
        { envelope: smithEnvelope(), kind: input.reason, payload: input.payload },
      );
      return { request_id: r.request_id ?? "unknown" };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.governance.hitl.request" }, "degraded");
      return degraded({ request_id: "degraded" }, "eights-mcp-unavailable");
    }
  }

  async governanceHitlList(input: {
    status?: string;
    limit?: number;
  } = {}): Promise<{ requests: unknown[] } | (DegradedMarker & { requests: unknown[] })> {
    try {
      const r = await this.client.call<{ requests?: unknown[] }>(
        "eights.governance.hitl.list",
        { envelope: smithEnvelope(), status: input.status ?? "pending" },
      );
      return { requests: r.requests ?? [] };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.governance.hitl.list" }, "degraded");
      return degraded({ requests: [] as unknown[] }, "eights-mcp-unavailable");
    }
  }

  /**
   * Attest the local Smith constitution against TheEights' stored record.
   *
   * N8 contract: the receipt must exist AND `receipt.content_hash` must equal
   * `"sha256:" + localHash` exactly. Any mismatch — including a degraded receipt,
   * an absent hash, or a hash that doesn't match — is an N8 violation and the
   * caller MUST boot in N8-refusal mode.
   *
   * The comparison hash is ALWAYS sourced internally from `this.gate.constitutionHash()`
   * (injected at construction). A caller-supplied hash cannot override this — the
   * gate is the only authoritative local source. If no gate is injected (no hash
   * source), returns degraded("eights-attest-no-local-hash") immediately.
   *
   * TheEights' engine stores the content_hash with a `"sha256:"` prefix
   * (see TheEights/daemon/src/engines/constitution.ts:103), so the comparison is:
   *   receipt.content_hash === "sha256:" + resolvedLocalHash
   *
   * `traceId` is bound to the audit record in TheEights (workflow-intake binding).
   */
  async constitutionAttest(
    traceId: string,
    consumer: EightsConsumer = DEFAULT_ATTEST_CONSUMER,
  ): Promise<AttestReceipt | (DegradedMarker & AttestReceipt)> {
    // Hash is ALWAYS sourced internally — no external override permitted.
    let resolvedLocalHash: string | undefined;
    try {
      resolvedLocalHash = this.gate?.constitutionHash();
    } catch (err) {
      this.log.warn(
        { tool: "eights.constitution.attest", err: String(err) },
        "attest: constitutionHash() threw — refusing (N8 requires comparison)",
      );
      return degraded(
        { receipt_id: "degraded", hash: "0".repeat(64), consumer },
        "eights-attest-hash-threw",
      );
    }
    if (!resolvedLocalHash) {
      this.log.warn(
        { tool: "eights.constitution.attest" },
        "attest: no gate/hash source available — refusing (N8 requires comparison)",
      );
      return degraded(
        { receipt_id: "degraded", hash: "0".repeat(64), consumer },
        "eights-attest-no-local-hash",
      );
    }

    try {
      // eights.constitution.attest returns a ConstitutionReceipt:
      // { consumer, rid, version, content_hash, attested_at, trace_id, receipt_signature }.
      // content_hash = "sha256:<hex>" (with prefix — see ConstitutionEngine.attest:103).
      const r = await this.client.call<{
        consumer?: string;
        rid?: string;
        version?: string;
        content_hash?: string;
        attested_at?: string;
        trace_id?: string;
        receipt_signature?: string;
      }>("eights.constitution.attest", { envelope: smithEnvelope(traceId), consumer });
      const signature = r.receipt_signature ?? "";
      const content_hash = r.content_hash ?? "";
      if (!signature || !content_hash) {
        // Reached the engine but got an unexpected shape — surface, don't fake a receipt.
        this.log.warn({ tool: "eights.constitution.attest", got: r }, "attest: unexpected response shape");
        return degraded(
          { receipt_id: "unknown", hash: "0".repeat(64), consumer },
          "eights-attest-bad-shape",
        );
      }
      // N8 hash comparison — ALWAYS performed (Issue 3: mandatory, not optional).
      const expected = `sha256:${resolvedLocalHash}`;
      if (content_hash !== expected) {
        this.log.warn(
          { tool: "eights.constitution.attest", expected, got: content_hash },
          "attest: content_hash mismatch — N8 violation",
        );
        return degraded(
          { receipt_id: "unknown", hash: content_hash, consumer },
          "eights-attest-hash-mismatch",
        );
      }
      return {
        receipt_id: signature, // back-compat alias; canonical id is receipt_signature
        hash: content_hash,
        receipt_signature: signature,
        consumer: r.consumer ?? consumer,
        version: r.version,
        content_hash: r.content_hash,
        attested_at: r.attested_at,
        trace_id: r.trace_id,
      };
    } catch (err) {
      // Distinguish a tool-level refusal (e.g. no constitution registered) from a
      // transport failure so callers don't misread a clean refusal as "unavailable".
      const msg = String(err);
      const reason = msg.includes("refusing attestation") || msg.includes("content drift")
        ? "eights-attest-refused"
        : "eights-mcp-unavailable";
      this.log.warn({ err: msg, tool: "eights.constitution.attest", reason }, "degraded");
      return degraded({ receipt_id: "degraded", hash: "0".repeat(64), consumer }, reason);
    }
  }

  /**
   * R3-tail post-mortem Fix 2.3 (2026-05-21): cross-project envelope lookup.
   *
   * Look up an envelope/attempt id in TheEights' shared ledger via the
   * audit trace. Returns true if the eights daemon recognizes the id
   * (typically because Hydra emitted an `envelope_record` event for it
   * earlier in the workflow), false otherwise.
   *
   * Background: during R3-tail recovery, smith-archivist seal of
   * DR-2026-018 was deferred because `agentsmith.eights.*` tools returned
   * "attempt not found" — AgentSmith's local ledger doesn't have the
   * envelope_id Hydra had created. The fix is to look up via the shared
   * eights ledger (which both Hydra and AgentSmith write to) before
   * declaring an attempt unknown. This lets smith-archivist seal a
   * Hydra-originated DR even though AgentSmith never saw the envelope
   * directly.
   *
   * Fail-soft: returns false on any bridge error (the caller decides
   * whether to surface "not found" or to continue degraded).
   */
  async lookupEnvelopeAttempt(attempt_id: string): Promise<{ found: boolean; via_kinds: string[] }> {
    try {
      const out = await this.auditTrace({ trace_id: attempt_id, limit: 5 });
      if ((out as DegradedMarker).degraded) {
        return { found: false, via_kinds: [] };
      }
      const events = (out as { events: Array<{ kind: string }> }).events ?? [];
      if (events.length === 0) {
        return { found: false, via_kinds: [] };
      }
      return {
        found: true,
        via_kinds: [...new Set(events.map(e => e.kind).filter(Boolean))],
      };
    } catch {
      return { found: false, via_kinds: [] };
    }
  }

  async auditTrace(input: {
    trace_id?: string;
    scope?: string;
    since?: string;
    limit?: number;
  }): Promise<
    | { events: Array<{ ts?: string; kind: string; payload: unknown }> }
    | (DegradedMarker & { events: Array<{ ts?: string; kind: string; payload: unknown }> })
  > {
    try {
      const r = await this.client.call<{
        events?: Array<{ ts?: string; kind?: string; payload?: unknown }>;
      }>("eights.audit.trace", input);
      const events = (r.events ?? []).map((e) => ({
        ts: e.ts,
        kind: e.kind ?? "event",
        payload: e.payload ?? null,
      }));
      return { events };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.audit.trace" }, "degraded");
      return degraded(
        { events: [] as Array<{ ts?: string; kind: string; payload: unknown }> },
        "eights-mcp-unavailable",
      );
    }
  }

  /**
   * Polling tail. TheEights does not (yet) expose a streaming `observability.tail`
   * MCP tool, so we approximate one by repeatedly calling `eights.audit.trace`
   * (cheap, idempotent) and yielding new events. Closes silently on any error.
   */
  observabilityTail(
    scope: string,
    intervalMs = 1000,
  ): AsyncIterable<{ kind: string; payload: unknown }> {
    const client = this.client;
    const log = this.log;
    return (async function* () {
      let lastCursor: string | undefined;
      while (true) {
        try {
          const args: Record<string, unknown> = { scope };
          if (lastCursor) args["since"] = lastCursor;
          const r = await client.call<{
            events?: Array<{ kind?: string; payload?: unknown; cursor?: string }>;
          }>("eights.audit.trace", args);
          const events = r.events ?? [];
          for (const ev of events) {
            yield { kind: ev.kind ?? "event", payload: ev.payload ?? null };
            if (ev.cursor) lastCursor = ev.cursor;
          }
        } catch (err) {
          log.debug?.({ err: String(err), scope }, "observabilityTail degraded — stopping");
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    })();
  }
}
