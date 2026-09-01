import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { nanoid } from "nanoid";
import { tailJsonlFile } from "./tail.js";
import { consumerRoots } from "../config.js";
import { selectTailTargets, tailBudget, yieldToEventLoop, type TailCandidate } from "./tail-budget.js";
import type { AnomalyEvent, AnomalySeverity } from "../schemas/anomaly.js";

/** `<hydraRoot>/.hydra` — derived from consumerRoots (AIAPP_BASE/anchor based). */
function defaultHydraRoot(): string {
  return join(consumerRoots()["hydra"]!, ".hydra");
}
const SCAN_INTERVAL_MS = 5000;

export interface HydraTailOptions {
  hydraRoot?: string;
  scanIntervalMs?: number;
  onError?: (err: unknown) => void;
  /** Max concurrently tailed trace files. Default from tailBudget(). */
  maxFiles?: number;
  /** Ignore traces whose mtime is older than this. Default from tailBudget(). */
  maxAgeMs?: number;
}

/**
 * Watches every `<hydraRoot>/<workflow_id>/trace.jsonl`. New workflow
 * directories are discovered every `scanIntervalMs`. Each appended line
 * becomes an AnomalyEvent with source="hydra.telemetry".
 */
export function startHydraTail(
  onEvent: (event: AnomalyEvent) => void,
  options: HydraTailOptions = {}
): { stop: () => void } {
  const root = options.hydraRoot ?? defaultHydraRoot();
  const interval = options.scanIntervalMs ?? SCAN_INTERVAL_MS;
  const onError = options.onError ?? (() => undefined);
  const defaults = tailBudget();
  const budget = {
    maxFiles: options.maxFiles ?? defaults.maxFiles,
    maxAgeMs: options.maxAgeMs ?? defaults.maxAgeMs,
  };

  const tails = new Map<string, { stop: () => void }>();
  let stopped = false;
  // First scan = boot: pre-existing trace.jsonl files hold history and are
  // tailed from EOF; workflow dirs appearing later are new and read from 0.
  let firstScan = true;

  const attach = (workflowId: string, tracePath: string, seekToEnd: boolean): void => {
    if (tails.has(tracePath)) return;
    try {
      const t = tailJsonlFile(tracePath, (record) => {
        try {
          const summary = JSON.stringify(record);
          const sev = inferSeverity(record);
          const evt: AnomalyEvent = {
            event_id: `evt_${nanoid(10)}`,
            severity: sev,
            source: "hydra.telemetry",
            payload_summary: summary.length > 4000 ? summary.slice(0, 4000) : summary,
            observed_at: new Date().toISOString(),
            scope: workflowId,
          };
          onEvent(evt);
        } catch (err) {
          onError(err);
        }
      }, { seekToEnd });
      tails.set(tracePath, t);
    } catch (err) {
      onError(err);
    }
  };

  // Async + budgeted (E2-10): the walk yields to the event loop and only the
  // freshest `budget.maxFiles` traces are tailed, so a directory holding tens
  // of thousands of historical workflows can never block the MCP transport.
  const scan = async (): Promise<void> => {
    if (stopped) return;
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (err) {
      // Missing root is the normal "Hydra not installed here" case.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") onError(err);
      return;
    }

    const candidates: TailCandidate[] = [];
    let walked = 0;
    for (const name of entries) {
      if (stopped) return;
      if (++walked % 200 === 0) await yieldToEventLoop();
      const trace = join(root, name, "trace.jsonl");
      try {
        const st = await stat(trace);
        if (!st.isFile()) continue;
        candidates.push({ path: trace, scope: name, mtimeMs: st.mtimeMs });
      } catch {
        continue;
      }
    }
    if (stopped) return;

    const seekToEnd = firstScan;
    for (const target of selectTailTargets(candidates, budget, new Set(tails.keys()))) {
      if (stopped) return;
      if (!tails.has(target.path)) attach(target.scope, target.path, seekToEnd);
    }
    firstScan = false;
  };

  let scanning = false;
  const runScan = (): void => {
    if (scanning || stopped) return;
    scanning = true;
    void scan()
      .catch(onError)
      .finally(() => {
        scanning = false;
      });
  };

  runScan();
  const timer = setInterval(runScan, interval);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const t of tails.values()) {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      }
      tails.clear();
    },
  };
}

function inferSeverity(record: unknown): AnomalySeverity {
  if (record && typeof record === "object") {
    const r = record as Record<string, unknown>;
    const s = String(r["severity"] ?? r["level"] ?? "").toLowerCase();
    if (s === "critical" || s === "high" || s === "medium" || s === "low" || s === "info") {
      return s;
    }
    if (s === "error" || s === "fatal") return "high";
    if (s === "warn" || s === "warning") return "medium";
  }
  return "info";
}
