/**
 * Tail budget — the guard that keeps the sentinel's boot scan off the hot path.
 *
 * WHY (finding E2-10): `startHydraTail` scanned `<Hydra>/.hydra/*` and attached
 * a tail to EVERY workflow's `trace.jsonl`. On a mature install that directory
 * holds ~16.5k workflow dirs, so the *synchronous* boot scan performed ~50k
 * blocking fs calls, wired ~16.5k `fs.watch` handles and ~16.5k 1-second poll
 * timers. Measured: the scan blocked the event loop for ~29s and left it
 * permanently saturated, which is what pushed the MCP `initialize` response out
 * past 48s and made the daemon look "not connected" / drop pooled connections.
 *
 * The tails exist to spot anomalies in ACTIVE work, so an unbounded historical
 * fan-out buys nothing. This module bounds it two ways — recency and count —
 * and provides the yield helper that keeps a scan cooperative.
 */

export interface TailBudget {
  /** Max files tailed concurrently per tail source. */
  maxFiles: number;
  /** Files whose mtime is older than this are not tailed. */
  maxAgeMs: number;
}

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function tailBudget(): TailBudget {
  return {
    maxFiles: Math.floor(positiveNumber(process.env["AGENTSMITH_TAIL_MAX_FILES"], DEFAULT_MAX_FILES)),
    maxAgeMs: Math.floor(positiveNumber(process.env["AGENTSMITH_TAIL_MAX_AGE_MS"], DEFAULT_MAX_AGE_MS)),
  };
}

export interface TailCandidate {
  path: string;
  scope: string;
  mtimeMs: number;
}

/**
 * Pick the tail targets: drop anything older than `maxAgeMs`, then keep the
 * `maxFiles` most recently modified. Already-attached paths are always kept
 * (dropping a live tail mid-run would silently blind the sentinel) and count
 * against the budget.
 */
export function selectTailTargets(
  candidates: TailCandidate[],
  budget: TailBudget,
  attached: ReadonlySet<string>,
  now: number = Date.now(),
): TailCandidate[] {
  const fresh = candidates.filter(
    (c) => attached.has(c.path) || now - c.mtimeMs <= budget.maxAgeMs,
  );
  fresh.sort((a, b) => {
    const aAttached = attached.has(a.path) ? 1 : 0;
    const bAttached = attached.has(b.path) ? 1 : 0;
    if (aAttached !== bAttached) return bAttached - aAttached;
    return b.mtimeMs - a.mtimeMs;
  });
  return fresh.slice(0, budget.maxFiles);
}

/** Hand the event loop back so a long directory walk never starves it. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
