#!/usr/bin/env node
/**
 * agentsmith-daemon entry point — Phase 0.
 *
 * Wires the four-pillar kernel:
 *   - Factory: scaffolds agent/skill/command/hook/team/squad/rubric/mcp drafts
 *   - Inspector: schema + invariant validators (constitution-bound)
 *   - Sentinel: watcher + classifier + replication controller (quota-bounded)
 *   - Archivist: decision store + audit trace + quarantine + keymaker registry
 *
 * Speaks MCP over stdio under the namespace `agentsmith.*`.
 *
 * "Never send a human to do a machine's job."
 */
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { makeLogger } from "./logger.js";
import { Inspector } from "./inspector/index.js";
import { Factory } from "./factory/index.js";
import {
  Watcher,
  Classifier,
  ReplicationController,
  loadDefaultSignatures,
  startHydraTail,
  startEightsTail,
} from "./sentinel/index.js";
import type { AnomalyEvent } from "./schemas/anomaly.js";
import { Isolator } from "./quarantine/index.js";
import { Registry } from "./keymaker/index.js";
import { DecisionStore } from "./archivist/index.js";
import { EightsBridge, HydraBridge, PpBridge, ConsumerBridge, classifyAttestOutcome, type SinkGateRefs, type AttestClass } from "./bridges/index.js";
import { startMcpServer } from "./mcp/server.js";
import { registerTools, buildN8RefusalTools, type SmithKernel } from "./mcp/tools.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  mkdirSync(cfg.agentsmithHome, { recursive: true });
  const log = makeLogger(cfg.logsDir);

  const inspector = new Inspector(cfg);
  let hash: string;
  try {
    hash = inspector.constitutionHash();
    log.info({ constitution_sha256: hash }, "constitution sealed");
  } catch (err) {
    // AS-GV-2: constitution unloadable — fatal, do NOT serve.
    log.error({ err: String(err) }, "N8: constitution unloadable — refusing to serve (fatal)");
    process.exitCode = 1;
    return;
  }

  const factory = new Factory(cfg);
  const watcher = new Watcher();
  const classifier = new Classifier();
  classifier.loadSignatures(loadDefaultSignatures());
  const replication = new ReplicationController(cfg);
  const isolator = new Isolator(cfg);
  const registry = new Registry(cfg);
  const decisions = new DecisionStore(cfg);
  const bridgeLogger = {
    warn: (o: Record<string, unknown>, m?: string) => log.warn(o, m),
    error: (o: Record<string, unknown>, m?: string) => log.error(o, m),
    info: (o: Record<string, unknown>, m?: string) => log.info(o, m),
    debug: (o: Record<string, unknown>, m?: string) => log.debug(o, m),
  };

  // NOTE: bridges are fully lazy — they connect (and spawn their child MCP
  // server) only when a tool actually calls through them.

  // hydra and inspector must be constructed before eights so the sink gate
  // refs can be injected at construction time. bootAttestedHash = hash (the
  // local constitution hash verified above); the gate TOCTOU check recomputes
  // and compares on every gated op to catch post-boot drift.
  const hydra = new HydraBridge({ logger: bridgeLogger });

  const sinkGate: SinkGateRefs = {
    inspectContent: async (content: string, id?: string) => {
      const v = await inspector.inspect({ kind: "agent", content, id });
      return { outcome: v.outcome, rationale: v.rationale, cited_invariants: v.cited_invariants };
    },
    venomCheck: async (capability: string, args: unknown) => {
      const r = await hydra.venomCrossCheck(capability, args);
      return { ok: r.ok === true, rationale: r.rationale };
    },
    constitutionHash: () => inspector.constitutionHash(),
    bootAttestedHash: hash,
  };

  const eights = new EightsBridge({ logger: bridgeLogger, gate: sinkGate });
  const pp = new PpBridge({ logger: bridgeLogger });
  const consumer = new ConsumerBridge(cfg);

  const kernel: SmithKernel = {
    cfg,
    inspector,
    factory,
    watcher,
    classifier,
    replication,
    isolator,
    registry,
    decisions,
    eights,
    hydra,
    pp,
    consumer,
  };

  // AS-GV-2 / N8 boot resilience: attest the Smith constitution hash via
  // TheEights at boot, but distinguish a *transport* race (TheEights still
  // cold-starting — opening episodic.db, audit-repair, seeding constitutions)
  // from a *terminal* N8 violation (hash mismatch / attest refused).
  //
  //   - attested           -> serve real tools.
  //   - terminal degraded  -> serve N8-refusal, stay closed (genuine violation).
  //   - transport degraded -> serve N8-refusal now, but keep re-attesting in the
  //                           background; lift the refusal in place once eights
  //                           becomes reachable and the hash matches.
  //
  // Fail-closed is preserved: only transport races are retried/deferred. A real
  // hash mismatch or attest refusal is never lifted in the background.
  // Crash (process.exitCode=1, no serve) only on constitutionHash() throw above.
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  const attestOnce = async (): Promise<{ cls: AttestClass; detail: string }> => {
    try {
      // The bridge sources the local hash internally and attests against
      // AgentSmith's OWN consumer slot (DEFAULT_ATTEST_CONSUMER = "agentsmith").
      // traceId = hash binds this attempt's audit record to the local hash.
      const receipt = await eights.constitutionAttest(hash);
      return classifyAttestOutcome(receipt);
    } catch (err) {
      // A thrown error here is a transport-level surprise — treat as retryable.
      return { cls: "transport", detail: `attest threw: ${String(err)}` };
    }
  };

  // Bounded boot retry: give a cold-starting eights a few seconds before
  // committing to a refusal map. Retry ONLY transport outcomes.
  const bootAttempts = Math.max(1, Number(process.env["AGENTSMITH_BOOT_ATTEST_ATTEMPTS"] ?? 5));
  let attestMode: "attested" | "n8-refusal" = "n8-refusal";
  let attestDetail = "not attempted";
  let transportDegraded = false;
  for (let attempt = 1; attempt <= bootAttempts; attempt += 1) {
    const { cls, detail } = await attestOnce();
    attestDetail = detail;
    if (cls === "attested") {
      attestMode = "attested";
      transportDegraded = false;
      log.info({ constitution_sha256: hash, detail }, "N8: constitution attested — booting normally");
      break;
    }
    if (cls === "terminal") {
      transportDegraded = false;
      log.warn({ local_sha256: hash, detail }, "N8: constitution attest terminal — booting in N8-refusal mode (fail-closed)");
      break;
    }
    // transport — retry with linear backoff (1s, 2s, 3s, 4s, capped at 5s)
    transportDegraded = true;
    log.warn({ attempt, of: bootAttempts, local_sha256: hash, detail }, "N8: attest transport-degraded — retrying");
    if (attempt < bootAttempts) await sleep(Math.min(attempt, 5) * 1000);
  }

  const tools = attestMode === "attested"
    ? registerTools(kernel)
    : buildN8RefusalTools(kernel, attestDetail);
  if (attestMode === "attested") {
    log.info({ tool_count: tools.size, mode: "attested" }, "agentsmith MCP tools registered");
  } else {
    log.warn({ tool_count: tools.size, mode: "n8-refusal", detail: attestDetail }, "agentsmith booted in N8-refusal mode — all tool calls will be refused");
  }

  // Background re-attest: only when the boot ended on a transport race. The MCP
  // server reads the live tools Map per request (mcp/server.ts), so replacing
  // the refusal entries in place lifts the N8-refusal with no restart. A later
  // terminal mismatch stops the loop and stays refused (fail-closed).
  if (attestMode === "n8-refusal" && transportDegraded) {
    let stopped = false;
    const stopReattest = (): void => { stopped = true; };
    process.on("SIGINT", stopReattest);
    process.on("SIGTERM", stopReattest);
    void (async () => {
      let delay = 10000;
      const maxDelay = 30000;
      while (!stopped) {
        await sleep(delay);
        if (stopped) return;
        const { cls, detail } = await attestOnce();
        if (cls === "attested") {
          const real = registerTools(kernel);
          for (const [name, def] of real) tools.set(name, def);
          log.info({ constitution_sha256: hash, detail, tool_count: tools.size }, "N8: constitution attested (deferred) — lifting refusal");
          try {
            decisions.seal({
              actor: "smith-boot",
              subject_kind: "constitution",
              subject_id: hash,
              verdict: {
                outcome: "allow",
                rationale: "N8 constitution attested (deferred) — refusal lifted after eights became reachable",
                cited_invariants: ["N8"],
                evidence: [{ key: "receipt", value: detail }],
                decided_at: new Date().toISOString(),
              },
            });
          } catch (sealErr) {
            log.warn({ err: String(sealErr) }, "failed to seal deferred-attest decision");
          }
          return;
        }
        if (cls === "terminal") {
          log.warn({ detail }, "N8: deferred attest hit terminal mismatch — staying refused (fail-closed)");
          return;
        }
        // still transport — keep trying with capped backoff
        delay = Math.min(delay + 5000, maxDelay);
      }
    })();
  }

  // Wire tail watchers — best-effort. Each emitted event is classified;
  // a match publishes to the in-process watcher and seals a decision record.
  const handleTailEvent = (event: AnomalyEvent): void => {
    void (async () => {
      try {
        const { matched } = classifier.classify(event);
        if (!matched) return;
        const enriched: AnomalyEvent = { ...event, signature_id: matched.id, severity: matched.severity };
        await watcher.publish(enriched);
        try {
          decisions.seal({
            actor: "smith-sentinel",
            subject_kind: "anomaly",
            subject_id: enriched.event_id,
            verdict: {
              outcome: matched.severity === "critical" ? "escalate" : "deny",
              rationale: matched.name,
              cited_invariants: matched.related_invariant ? [matched.related_invariant] : [],
              evidence: [
                { key: "signature_id", value: matched.id },
                { key: "source", value: enriched.source },
              ],
              decided_at: new Date().toISOString(),
            },
          });
        } catch (sealErr) {
          log.warn({ err: String(sealErr) }, "failed to seal sentinel decision");
        }
      } catch (err) {
        log.warn({ err: String(err) }, "sentinel handler failure");
      }
    })();
  };

  // Bring the stdio MCP transport up FIRST so the gateway's initialize
  // handshake is answered immediately, before any tail warm-up. Combined with
  // the seekToEnd tails below (which no longer replay historical event logs),
  // this guarantees AgentSmith reaches MCP-ready well within the gateway's
  // connect window regardless of how large the on-disk event logs are.
  await startMcpServer(tools, "0.1.0");

  // Tail watchers start after the transport is live. Each emitted event is
  // classified; a match publishes to the in-process watcher and seals a
  // decision record. seekToEnd (in eights-tail/hydra-tail) ensures pre-existing
  // history is not re-read synchronously.
  try {
    const hydraTail = startHydraTail(handleTailEvent, {
      onError: (err) => log.warn({ err: String(err) }, "hydra-tail error"),
    });
    log.info("hydra telemetry tail started");
    process.on("SIGINT", () => hydraTail.stop());
    process.on("SIGTERM", () => hydraTail.stop());
  } catch (err) {
    log.warn({ err: String(err) }, "hydra-tail failed to start");
  }

  try {
    const eightsTail = startEightsTail(handleTailEvent, {
      onError: (err) => log.warn({ err: String(err) }, "eights-tail error"),
    });
    log.info("eights observability tail started");
    process.on("SIGINT", () => eightsTail.stop());
    process.on("SIGTERM", () => eightsTail.stop());
  } catch (err) {
    log.warn({ err: String(err) }, "eights-tail failed to start");
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[agentsmith] fatal:", err);
  process.exit(1);
});
