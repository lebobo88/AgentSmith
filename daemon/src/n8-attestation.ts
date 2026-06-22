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
  lastError?: string;
  escalated_at?: string;
}

export interface N8AttestationController {
  getDetail: () => string;
  getSnapshot: () => N8AttestationSnapshot;
  runLoop: () => Promise<void>;
  reattest: () => Promise<Record<string, unknown>>;
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
  const snapshot: N8AttestationSnapshot = {
    mode: "retrying",
    attempt: 0,
    detail: "boot attest pending",
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
        opts.log.warn(
          { local_sha256: opts.hash, detail: outcome.detail },
          "N8: constitution attest terminal — staying in N8-refusal (fail-closed)",
        );
        return outcome;
      }

      snapshot.mode = "retrying";
      snapshot.lastError = outcome.detail;
      snapshot.detail = buildRetryDetail(snapshot.attempt, outcome.detail);
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
      const delay = snapshot.attempt < opts.bootAttempts
        ? Math.min(snapshot.attempt, 5) * 1000
        : Math.min(10000 + snapshot.attempt * 1000, 30000);
      await sleep(delay);
    }
  };

  const reattest = async (): Promise<Record<string, unknown>> => {
    const outcome = await runSingleAttempt();
    if (outcome.cls === "attested") {
      return {
        ok: true,
        attested: true,
        detail: snapshot.detail,
      };
    }
    return {
      ok: false,
      attested: false,
      refused: true,
      degraded: outcome.cls === "transport",
      reason: "N8: constitution unattested/mismatch — tools refused",
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
