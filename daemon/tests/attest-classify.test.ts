import { describe, it, expect } from "vitest";
import { classifyAttestOutcome } from "../src/bridges/eights-bridge.js";

/**
 * N8 boot-gate retry/defer policy hinges entirely on classifyAttestOutcome:
 * only a transport outcome may be retried or lifted in the background; every
 * genuine N8 violation must classify "terminal" (fail-closed, never lifted).
 */
describe("classifyAttestOutcome — N8 boot retry/defer policy", () => {
  const okReceipt = {
    receipt_id: "sig_abc",
    hash: "sha256:70a19de2",
    content_hash: "sha256:70a19de2",
  };

  it("clean receipt → attested", () => {
    const { cls } = classifyAttestOutcome(okReceipt);
    expect(cls).toBe("attested");
  });

  it("eights-mcp-unavailable is the ONLY retryable (transport) reason", () => {
    const { cls } = classifyAttestOutcome({
      receipt_id: "degraded",
      hash: "0".repeat(64),
      degraded: true,
      reason: "eights-mcp-unavailable",
    });
    expect(cls).toBe("transport");
  });

  it.each([
    "eights-attest-hash-mismatch",
    "eights-attest-refused",
    "eights-attest-bad-shape",
    "eights-attest-no-local-hash",
    "eights-attest-hash-threw",
  ])("genuine N8 violation %s → terminal (fail-closed, never retried)", (reason) => {
    const { cls } = classifyAttestOutcome({
      receipt_id: "unknown",
      hash: "0".repeat(64),
      degraded: true,
      reason,
    });
    expect(cls).toBe("terminal");
  });

  it("non-degraded but missing content_hash → terminal", () => {
    const { cls } = classifyAttestOutcome({
      receipt_id: "sig_abc",
      hash: "",
    } as never);
    expect(cls).toBe("terminal");
  });

  it("non-degraded with receipt_id 'degraded' sentinel → terminal", () => {
    const { cls } = classifyAttestOutcome({
      receipt_id: "degraded",
      hash: "sha256:x",
      content_hash: "sha256:x",
    });
    expect(cls).toBe("terminal");
  });

  it("detail surfaces the degraded reason for logs", () => {
    const { detail } = classifyAttestOutcome({
      receipt_id: "degraded",
      hash: "0".repeat(64),
      degraded: true,
      reason: "eights-mcp-unavailable",
    });
    expect(detail).toContain("eights-mcp-unavailable");
  });
});
