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
import { EightsBridge, HydraBridge, PpBridge, ConsumerBridge } from "./bridges/index.js";
import { startMcpServer } from "./mcp/server.js";
import { registerTools, type SmithKernel } from "./mcp/tools.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  mkdirSync(cfg.agentsmithHome, { recursive: true });
  const log = makeLogger(cfg.logsDir);

  const inspector = new Inspector(cfg);
  let hash = "uninitialized";
  try {
    hash = inspector.constitutionHash();
    log.info({ constitution_sha256: hash }, "constitution sealed");
  } catch (err) {
    log.warn({ err: String(err) }, "constitution not yet loadable; Phase 0 degraded");
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
  const eights = new EightsBridge({ logger: bridgeLogger });
  const hydra = new HydraBridge({ logger: bridgeLogger });
  const pp = new PpBridge({ logger: bridgeLogger });
  const consumer = new ConsumerBridge(cfg);

  // NOTE: bridges are fully lazy — they connect (and spawn their child MCP
  // server) only when a tool actually calls through them. We deliberately do
  // NOT probe availability at boot: the old `eights.available()` probe spawned
  // a child `node TheEights/daemon/dist/index.js` on every AgentSmith start,
  // and the 1s race did not cancel the underlying connect, orphaning a child
  // doing a slow cold-open against TheEights' large DB/WAL. Removing the probe
  // eliminates a redundant long-lived Eights connection (which also fed WAL
  // checkpoint starvation) and shaves boot time off the gateway's connect path.

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

  const tools = registerTools(kernel);
  log.info({ tool_count: tools.size }, "agentsmith MCP tools registered");

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
