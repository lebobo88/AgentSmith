import { describe, it, expect, vi } from "vitest";
import { createN8AttestationController, startSupervisedAttestLoop } from "../src/n8-attestation.js";

describe("N8 attestation supervisor", () => {
  it("restarts the background run after an injected rejection", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const runAttest = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom");
      }
      return new Promise<void>(() => undefined);
    });

    startSupervisedAttestLoop(runAttest, {
      log: { error: vi.fn() },
      sleep,
      restartDelayMs: 0,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runAttest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("N8 attestation controller detail", () => {
  it("updates refusal detail with live retry state after transport failures", async () => {
    const controller = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce: vi.fn()
        .mockResolvedValueOnce({ cls: "transport", detail: "degraded: eights-mcp-unavailable" })
        .mockResolvedValueOnce({ cls: "terminal", detail: "degraded: eights-attest-hash-mismatch" }),
      activateRealTools: vi.fn(),
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      sleep: vi.fn().mockResolvedValue(undefined),
      stopRequested: (() => {
        let checks = 0;
        return () => {
          checks += 1;
          return checks > 1;
        };
      })(),
    });

    await controller.runLoop();

    expect(controller.getDetail()).toBe(
      "boot attest retrying (attempt 1, last_error=degraded: eights-mcp-unavailable)",
    );

    const result = await controller.reattest();
    expect(result).toMatchObject({
      ok: false,
      refused: true,
      degraded: false,
      status: "terminal",
    });
    expect(controller.getDetail()).toBe(
      "boot attest fail-closed: degraded: eights-attest-hash-mismatch",
    );
  });
});
