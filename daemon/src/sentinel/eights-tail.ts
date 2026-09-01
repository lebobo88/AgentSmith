import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { tailJsonlFile } from "./tail.js";
import { selectTailTargets, tailBudget, yieldToEventLoop, type TailCandidate } from "./tail-budget.js";
import type { AnomalyEvent, AnomalySeverity } from "../schemas/anomaly.js";

const SCAN_INTERVAL_MS = 5000;

export interface EightsTailOptions {
  eventsDir?: string;
  scanIntervalMs?: number;
  onError?: (err: unknown) => void;
  /** Max concurrently tailed event logs. Default from tailBudget(). */
  maxFiles?: number;
  /** Ignore event logs whose mtime is older than this. Default from tailBudget(). */
  maxAgeMs?: number;
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
  const defaults = tailBudget();
  const budget = {
    maxFiles: options.maxFiles ?? defaults.maxFiles,
    maxAgeMs: options.maxAgeMs ?? defaults.maxAgeMs,
  };

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

  // Async + budgeted (E2-10) — same rationale as hydra-tail: the boot scan must
  // never block the MCP transport, and only recent event logs are worth tailing.
  const scan = async (): Promise<void> => {
    if (stopped) return;
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") onError(err);
      return;
    }

    const candidates: TailCandidate[] = [];
    let walked = 0;
    for (const name of entries) {
      if (stopped) return;
      if (!name.endsWith(".jsonl")) continue;
      if (++walked % 200 === 0) await yieldToEventLoop();
      const full = join(root, name);
      try {
        const st = await stat(full);
        if (!st.isFile()) continue;
        candidates.push({ path: full, scope: name, mtimeMs: st.mtimeMs });
      } catch {
        continue;
      }
    }
    if (stopped) return;

    const seekToEnd = firstScan;
    for (const target of selectTailTargets(candidates, budget, new Set(tails.keys()))) {
      if (stopped) return;
      if (!tails.has(target.path)) attach(target.path, seekToEnd);
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
