import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { tailJsonlFile } from "./tail.js";
import type { AnomalyEvent, AnomalySeverity } from "../schemas/anomaly.js";

const DEFAULT_HYDRA_ROOT = "C:/AiAppDeployments/Hydra/.hydra";
const SCAN_INTERVAL_MS = 5000;

export interface HydraTailOptions {
  hydraRoot?: string;
  scanIntervalMs?: number;
  onError?: (err: unknown) => void;
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
  const root = options.hydraRoot ?? DEFAULT_HYDRA_ROOT;
  const interval = options.scanIntervalMs ?? SCAN_INTERVAL_MS;
  const onError = options.onError ?? (() => undefined);

  const tails = new Map<string, { stop: () => void }>();
  let stopped = false;

  const attach = (workflowId: string, tracePath: string): void => {
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
      });
      tails.set(tracePath, t);
    } catch (err) {
      onError(err);
    }
  };

  const scan = (): void => {
    if (stopped) return;
    if (!existsSync(root)) return;
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch (err) {
      onError(err);
      return;
    }
    for (const name of entries) {
      const dir = join(root, name);
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      const trace = join(dir, "trace.jsonl");
      if (!tails.has(trace)) attach(name, trace);
    }
  };

  scan();
  const timer = setInterval(scan, interval);

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
