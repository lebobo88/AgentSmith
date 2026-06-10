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
import { EightsBridge, HydraBridge, PpBridge, ConsumerBridge, type SinkGateRefs } from "./bridges/index.js";
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

  // AS-GV-2 (fixed): N8 — attest the Smith constitution hash via TheEights at boot.
  //
  // The eights bridge now accepts `localHash` and compares the attested
  // content_hash ("sha256:<hex>") to "sha256:" + localHash. Only an exact match
  // selects normal tools. Any of the following boot in N8-refusal mode:
  //   - eights unreachable / transport failure (degraded)
  //   - constitution not registered in TheEights (refused)
  //   - content_hash mismatch (drift)
  //   - malformed/empty receipt
  // Crash (process.exitCode=1, no serve) only on constitutionHash() throw above.
  const tools = await (async () => {
    let attestMode: "attested" | "n8-refusal" = "n8-refusal";
    let attestDetail = "not attempted";
    try {
      // The bridge sources the local hash internally from sinkGate.constitutionHash().
      // traceId = hash so the audit record binds this boot to this exact local hash.
      const receipt = await eights.constitutionAttest(hash, "hydra");
      if ("degraded" in receipt && receipt.degraded) {
        const reason = (receipt as { reason: string }).reason;
        attestDetail = `degraded: ${reason}`;
        log.warn({ reason, local_sha256: hash }, "N8: constitution attest degraded/mismatch — booting in N8-refusal mode");
      } else if (!receipt.receipt_id || receipt.receipt_id === "degraded" || !receipt.content_hash) {
        attestDetail = "attest returned no valid receipt";
        log.warn({ receipt, local_sha256: hash }, "N8: constitution attest returned no valid receipt — booting in N8-refusal mode");
      } else {
        // Exact match confirmed by bridge (content_hash === "sha256:" + hash).
        attestMode = "attested";
        attestDetail = `receipt=${receipt.receipt_id} content_hash=${receipt.content_hash}`;
        log.info({ constitution_sha256: hash, receipt_id: receipt.receipt_id, content_hash: receipt.content_hash }, "N8: constitution attested — booting normally");
      }
    } catch (err) {
      attestDetail = `attest threw: ${String(err)}`;
      log.warn({ err: String(err), local_sha256: hash }, "N8: constitution attest threw — booting in N8-refusal mode");
    }

    if (attestMode === "attested") {
      const realTools = registerTools(kernel);
      log.info({ tool_count: realTools.size, mode: "attested" }, "agentsmith MCP tools registered");
      return realTools;
    }

    // N8-refusal tool map: derived by wrapping real tool handlers (see buildN8RefusalTools).
    const refusalTools = buildN8RefusalTools(kernel, attestDetail);
    log.warn({ tool_count: refusalTools.size, mode: "n8-refusal", detail: attestDetail }, "agentsmith booted in N8-refusal mode — all tool calls will be refused");
    return refusalTools;
  })();

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
