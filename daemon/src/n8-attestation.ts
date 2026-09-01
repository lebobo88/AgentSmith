import { randomUUID } from "node:crypto";
import type { AttestClass } from "./bridges/eights-bridge.js";

export interface N8AttestOutcome {
  cls: AttestClass;
  detail: string;
}

export interface N8AttestationSnapshot {
  mode: "retrying" | "terminal" | "attested";
  attempt: number;
  detail: string;
  /** Seconds a consumer should wait before re-polling while mode === "retrying". */
  retry_after_s: number;
  lastError?: string;
  escalated_at?: string;
}

export interface N8AttestationController {
  getDetail: () => string;
  getSnapshot: () => N8AttestationSnapshot;
  runLoop: () => Promise<void>;
  reattest: () => Promise<Record<string, unknown>>;
}

/** Reason string returned while boot attestation has not yet concluded. */
export const N8_PENDING_REASON = "boot attest pending";
/** Reason string returned for a genuine N8 violation (terminal, fail-closed). */
export const N8_REFUSED_REASON = "N8: constitution unattested/mismatch — tools refused";

/**
 * The structured "not yet" answer. Distinct from an N8 refusal: it carries
 * `status:"not_ready"` and NO `refused` flag, so a consumer (Hydra's
 * dispatcher / gateway) can retry instead of treating the daemon as a
 * constitutional violation. Only the transport-degraded ("retrying") mode
 * produces this; a hash mismatch stays `refused:true` forever.
 */
export function buildNotReadyResult(snapshot: N8AttestationSnapshot): Record<string, unknown> {
  return {
    ok: false,
    status: "not_ready",
    reason: N8_PENDING_REASON,
    retry_after_s: snapshot.retry_after_s,
    detail: snapshot.detail,
  };
}

/** The terminal fail-closed answer — the N8 invariant, unchanged. */
export function buildRefusalResult(snapshot: N8AttestationSnapshot): Record<string, unknown> {
  return {
    ok: false,
    refused: true,
    reason: N8_REFUSED_REASON,
    detail: snapshot.detail,
  };
}

interface AttestLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
}

interface TransportEscalation {
  failureThreshold: number;
  windowMs: number;
  emit: (snapshot: N8AttestationSnapshot) => Promise<void>;
}

interface N8AttestationControllerOptions {
  hash: string;
  bootAttempts: number;
  attestOnce: () => Promise<N8AttestOutcome>;
  activateRealTools: (detail: string) => Promise<void> | void;
  log: AttestLogger;
  stopRequested?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  escalation?: TransportEscalation;
  /**
   * Upper bound on how long a single `reattest()` MCP call may block before it
   * answers `not_ready`. The attempt itself keeps running in the background —
   * only the *response* is bounded. Without this, a slow TheEights cold start
   * held the MCP request open past the client's own request timeout, and the
   * client tore the pooled stdio connection down ("Connection closed") on the
   * NEXT call. Default 8s: comfortably inside the MCP SDK's 60s request
   * timeout and inside Hydra's dispatcher window.
   */
  reattestBudgetMs?: number;
}

/**
 * Backoff between background attest attempts. Shared by the retry loop and by
 * the `retry_after_s` hint handed to consumers so the two never disagree.
 */
function attemptDelayMs(attempt: number, bootAttempts: number): number {
  return attempt < bootAttempts
    ? Math.min(attempt, 5) * 1000
    : Math.min(10000 + attempt * 1000, 30000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRetryDetail(attempt: number, detail: string): string {
  return `boot attest retrying (attempt ${attempt}, last_error=${detail})`;
}

function buildTerminalDetail(detail: string): string {
  return `boot attest fail-closed: ${detail}`;
}

function buildAttestedDetail(detail: string): string {
  return `constitution attested: ${detail}`;
}

export function startSupervisedAttestLoop(
  runAttest: () => Promise<void>,
  deps: {
    log: Pick<AttestLogger, "error">;
    stopRequested?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    restartDelayMs?: number;
  },
): void {
  const sleep = deps.sleep ?? defaultSleep;
  const restartDelayMs = deps.restartDelayMs ?? 1000;
  const launch = (): void => {
    void runAttest().catch(async (err) => {
      deps.log.error({ err: String(err) }, "N8: attest loop crashed — restarting");
      if (deps.stopRequested?.()) return;
      await sleep(restartDelayMs);
      if (deps.stopRequested?.()) return;
      launch();
    });
  };
  launch();
}

export function createN8AttestationController(
  opts: N8AttestationControllerOptions,
): N8AttestationController {
  const sleep = opts.sleep ?? defaultSleep;
  const reattestBudgetMs = opts.reattestBudgetMs
    ?? Math.max(1000, Number(process.env["AGENTSMITH_REATTEST_BUDGET_MS"] ?? 8000));
  const snapshot: N8AttestationSnapshot = {
    mode: "retrying",
    attempt: 0,
    detail: N8_PENDING_REASON,
    retry_after_s: Math.ceil(attemptDelayMs(1, opts.bootAttempts) / 1000),
  };
  const failureTimes: number[] = [];
  let inFlight: Promise<N8AttestOutcome> | null = null;
  let escalationPromise: Promise<void> | null = null;

  const shouldStop = (): boolean => opts.stopRequested?.() === true;

  const maybeEscalateTransport = (): void => {
    if (!opts.escalation || escalationPromise) return;
    const now = Date.now();
    const cutoff = now - opts.escalation.windowMs;
    while (failureTimes.length > 0 && failureTimes[0]! < cutoff) {
      failureTimes.shift();
    }
    if (failureTimes.length < opts.escalation.failureThreshold) return;
    snapshot.escalated_at = new Date(now).toISOString();
    escalationPromise = opts.escalation.emit({ ...snapshot }).catch((err) => {
      opts.log.warn({ err: String(err), constitution_sha256: opts.hash }, "N8: transport escalation failed");
    }).finally(() => {
      escalationPromise = null;
    });
  };

  const runSingleAttempt = async (): Promise<N8AttestOutcome> => {
    if (inFlight) return inFlight;
    snapshot.attempt += 1;
    inFlight = (async () => {
      const outcome = await opts.attestOnce();
      if (outcome.cls === "attested") {
        snapshot.mode = "attested";
        snapshot.lastError = undefined;
        snapshot.detail = buildAttestedDetail(outcome.detail);
        snapshot.retry_after_s = 0;
        failureTimes.length = 0;
        await opts.activateRealTools(outcome.detail);
        opts.log.info(
          { constitution_sha256: opts.hash, detail: outcome.detail },
          "N8: constitution attested — real tools active",
        );
        return outcome;
      }

      if (outcome.cls === "terminal") {
        snapshot.mode = "terminal";
        snapshot.lastError = outcome.detail;
        snapshot.detail = buildTerminalDetail(outcome.detail);
        snapshot.retry_after_s = 0;
        opts.log.warn(
          { local_sha256: opts.hash, detail: outcome.detail },
          "N8: constitution attest terminal — staying in N8-refusal (fail-closed)",
        );
        return outcome;
      }

      snapshot.mode = "retrying";
      snapshot.lastError = outcome.detail;
      snapshot.detail = buildRetryDetail(snapshot.attempt, outcome.detail);
      snapshot.retry_after_s = Math.ceil(attemptDelayMs(snapshot.attempt, opts.bootAttempts) / 1000);
      failureTimes.push(Date.now());
      maybeEscalateTransport();
      opts.log.warn(
        { attempt: snapshot.attempt, local_sha256: opts.hash, detail: outcome.detail },
        "N8: attest transport-degraded — retrying in background",
      );
      return outcome;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const runLoop = async (): Promise<void> => {
    while (!shouldStop()) {
      if (snapshot.mode === "attested" || snapshot.mode === "terminal") return;
      const outcome = await runSingleAttempt();
      if (outcome.cls !== "transport") return;
      await sleep(attemptDelayMs(snapshot.attempt, opts.bootAttempts));
    }
  };

  /**
   * Re-run attestation on demand. ALWAYS returns — never rejects, never
   * outlives `reattestBudgetMs`, and never touches the stdio transport. When
   * the underlying attempt outruns the budget the in-flight promise keeps
   * running in the background (its result still updates the snapshot and can
   * still lift the refusal); this call just answers `not_ready` now so the
   * caller's pooled connection is not held open past its request timeout.
   */
  const reattest = async (): Promise<Record<string, unknown>> => {
    const attempt = runSingleAttempt().catch((err) => {
      opts.log.warn({ err: String(err), constitution_sha256: opts.hash }, "N8: reattest attempt threw");
      return { cls: "transport" as const, detail: `reattest threw: ${String(err)}` };
    });
    const budgeted = Symbol("budget-exceeded");
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<symbol>((resolve) => {
      budgetTimer = setTimeout(() => resolve(budgeted), reattestBudgetMs);
      // Do not hold the process open purely for the budget timer.
      (budgetTimer as unknown as { unref?: () => void }).unref?.();
    });
    const raced = await Promise.race([attempt, budget]);
    if (budgetTimer) clearTimeout(budgetTimer);

    if (raced === budgeted) {
      return { ...buildNotReadyResult(snapshot), attested: false, degraded: true };
    }

    const outcome = raced as N8AttestOutcome;
    if (outcome.cls === "attested") {
      return {
        ok: true,
        attested: true,
        detail: snapshot.detail,
      };
    }
    if (outcome.cls === "transport") {
      // Not a violation — TheEights is unreachable or still cold-starting.
      return { ...buildNotReadyResult(snapshot), attested: false, degraded: true };
    }
    return {
      ok: false,
      attested: false,
      refused: true,
      degraded: false,
      reason: N8_REFUSED_REASON,
      detail: snapshot.detail,
      status: snapshot.mode,
    };
  };

  return {
    getDetail: () => snapshot.detail,
    getSnapshot: () => ({ ...snapshot }),
    runLoop,
    reattest,
  };
}

export function createN8EscalationEvent(summary: string, scope = "agentsmith.boot.n8"): {
  event_id: string;
  severity: "high";
  source: "agentsmith.internal";
  payload_summary: string;
  observed_at: string;
  scope: string;
} {
  return {
    event_id: `n8_attest_${randomUUID()}`,
    severity: "high",
    source: "agentsmith.internal",
    payload_summary: summary,
    observed_at: new Date().toISOString(),
    scope,
  };
}
