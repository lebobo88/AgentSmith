import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EightsBridge } from "../src/bridges/eights-bridge.js";

/**
 * AS3 — eights proposal spool + replay.
 *
 * These tests verify the bridge's behavior at the McpClient boundary by
 * stubbing the internal client's `call` method. We never spawn a real
 * TheEights child process — the goal is to exercise the spool / replay
 * state machine, not the MCP protocol layer (covered by mcp-client tests
 * elsewhere if/when added).
 */

interface BridgeInternals {
  client: { call: (tool: string, args: unknown) => Promise<unknown> };
}

describe("AS3 — eights-bridge proposal spool + replay", () => {
  let spoolDir: string;
  let bridge: EightsBridge;
  let stubLogger: {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-spool-"));
    stubLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    bridge = new EightsBridge({
      spoolDir,
      logger: stubLogger,
      // Pass a no-op command so the McpClient is constructed but never used
      // unless we override its `call` method below.
      command: "node",
      args: ["--version"],
    });
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  function readSpool(): Array<Record<string, unknown>> {
    return readdirSync(spoolDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(spoolDir, f), "utf8")) as Record<string, unknown>);
  }

  it("(a) failed propose writes a SpooledProposal to disk and returns degraded marker", async () => {
    // Force the underlying call() to throw.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValue(new Error("EPIPE: eights unavailable"));

    const result = await bridge.evolutionPropose({
      rid: "rubric:test@1",
      candidate_content: "patch body",
      justification: "test reason",
      evidence_memory_ids: ["mem-1", "mem-2"],
    });

    expect("degraded" in result && result.degraded).toBe(true);
    expect(result.proposal_id).toBe("degraded");
    const spool = readSpool();
    expect(spool.length).toBe(1);
    expect(spool[0]!["tool"]).toBe("eights.evolution.propose");
    expect(spool[0]!["reason"]).toBe("eights-mcp-unavailable");
    expect((spool[0]!["args"] as Record<string, unknown>)["rid"]).toBe("rubric:test@1");
    expect(typeof spool[0]!["spooled_at"]).toBe("string");
  });

  it("(b) replayPendingProposals drains the spool when eights returns successfully", async () => {
    // First propose: eights down → spool 1 entry.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValueOnce(new Error("eights down 1"))
      .mockRejectedValueOnce(new Error("eights down 2"));

    await bridge.evolutionPropose({
      rid: "rubric:a@1",
      candidate_content: "a",
      justification: "ja",
    });
    await bridge.evolutionPropose({
      rid: "rubric:b@1",
      candidate_content: "b",
      justification: "jb",
    });
    expect(readSpool().length).toBe(2);

    // Now eights is back. Swap call() to resolve.
    const callMock = vi
      .fn()
      .mockResolvedValue({ proposal_id: "p-real", auto_committed: false });
    (bridge as unknown as BridgeInternals).client.call = callMock;

    const summary = await bridge.replayPendingProposals();
    expect(summary).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(readSpool().length).toBe(0);
    // Replay should have invoked the propose tool, once per spooled entry.
    const proposeCalls = callMock.mock.calls.filter((c) => c[0] === "eights.evolution.propose");
    expect(proposeCalls.length).toBe(2);
  });

  it("(c) corrupt files don't block draining the rest", async () => {
    // Spool one valid by failing a propose.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValueOnce(new Error("eights down"));
    await bridge.evolutionPropose({
      rid: "rubric:valid@1",
      candidate_content: "x",
      justification: "y",
    });
    expect(readSpool().length).toBe(1);

    // Drop a corrupt JSON file alongside.
    writeFileSync(join(spoolDir, "corrupt-aaa.json"), "{ not valid json", "utf8");

    // Drop a payload with a missing/unknown shape (parses fine, wrong tool).
    writeFileSync(
      join(spoolDir, "wrong-shape-bbb.json"),
      JSON.stringify({ id: "bbb", tool: "eights.something.else", args: {} }),
      "utf8",
    );

    // Now eights is back for replay.
    const callMock = vi.fn().mockResolvedValue({ proposal_id: "p-ok", auto_committed: false });
    (bridge as unknown as BridgeInternals).client.call = callMock;

    const summary = await bridge.replayPendingProposals();
    expect(summary.sent).toBe(1); // the one valid spooled propose
    expect(summary.skipped).toBe(2); // corrupt + wrong-shape
    expect(summary.failed).toBe(0);

    // Valid one is gone; the two bad ones are left in place.
    const remaining = readdirSync(spoolDir);
    expect(remaining.sort()).toEqual(["corrupt-aaa.json", "wrong-shape-bbb.json"].sort());
  });

  it("(d) successful new propose first drains the spool, then sends the new one", async () => {
    // Pre-seed the spool with one failed proposal.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValueOnce(new Error("eights down"));
    await bridge.evolutionPropose({
      rid: "rubric:queued@1",
      candidate_content: "queued",
      justification: "queued",
    });
    expect(readSpool().length).toBe(1);

    // Now eights is up. Next propose should drain + succeed.
    const callMock = vi
      .fn()
      .mockResolvedValueOnce({ proposal_id: "p-replayed", auto_committed: false }) // replay drain
      .mockResolvedValueOnce({ proposal_id: "p-new", auto_committed: true }); // new propose
    (bridge as unknown as BridgeInternals).client.call = callMock;

    const result = await bridge.evolutionPropose({
      rid: "rubric:new@1",
      candidate_content: "new",
      justification: "new",
    });

    expect("degraded" in result && result.degraded).toBeFalsy();
    expect(result.proposal_id).toBe("p-new");
    expect(result.auto_committed).toBe(true);
    expect(readSpool().length).toBe(0);
    // The new propose's args were forwarded to client.call exactly once.
    const newCalls = callMock.mock.calls.filter(
      (c) => c[0] === "eights.evolution.propose" && (c[1] as { rid: string }).rid === "rubric:new@1",
    );
    expect(newCalls.length).toBe(1);
  });

  it("(e) replay failure leaves the file for next attempt", async () => {
    // Spool one.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValueOnce(new Error("eights down"));
    await bridge.evolutionPropose({
      rid: "rubric:stuck@1",
      candidate_content: "x",
      justification: "y",
    });
    expect(readSpool().length).toBe(1);

    // Replay also fails — file should stay.
    (bridge as unknown as BridgeInternals).client.call = vi
      .fn()
      .mockRejectedValue(new Error("still down"));
    const summary = await bridge.replayPendingProposals();
    expect(summary).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(readSpool().length).toBe(1);
  });
});
