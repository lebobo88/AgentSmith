import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { tailJsonlFile } from "./tail.js";
import type { AnomalyEvent, AnomalySeverity } from "../schemas/anomaly.js";

const SCAN_INTERVAL_MS = 5000;

export interface EightsTailOptions {
  eventsDir?: string;
  scanIntervalMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Watches every `<eventsDir>/*.jsonl`. Defaults to `~/.eights/events/`.
 * Each appended line becomes an AnomalyEvent with source="eights.observability".
 */
export function startEightsTail(
  onEvent: (event: AnomalyEvent) => void,
  options: EightsTailOptions = {}
): { stop: () => void } {
  const root = options.eventsDir ?? join(homedir(), ".eights", "events");
  const interval = options.scanIntervalMs ?? SCAN_INTERVAL_MS;
  const onError = options.onError ?? (() => undefined);

  const tails = new Map<string, { stop: () => void }>();
  let stopped = false;
  // The first scan happens at daemon boot: files already on disk hold history
  // (the events dir can be hundreds of MB) and MUST be tailed from EOF, never
  // replayed synchronously. Files that first appear in a *later* scan are new
  // (start small) and are read from offset 0.
  let firstScan = true;

  const attach = (filePath: string, seekToEnd: boolean): void => {
    if (tails.has(filePath)) return;
    try {
      const t = tailJsonlFile(filePath, (record) => {
        try {
          const summary = JSON.stringify(record);
          const sev = inferSeverity(record);
          const evt: AnomalyEvent = {
            event_id: `evt_${nanoid(10)}`,
            severity: sev,
            source: "eights.observability",
            payload_summary: summary.length > 4000 ? summary.slice(0, 4000) : summary,
            observed_at: new Date().toISOString(),
          };
          onEvent(evt);
        } catch (err) {
          onError(err);
        }
      }, { seekToEnd });
      tails.set(filePath, t);
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
    const seekToEnd = firstScan;
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(root, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      if (!tails.has(full)) attach(full, seekToEnd);
    }
    firstScan = false;
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
