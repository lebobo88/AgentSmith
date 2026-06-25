import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HydraBridge } from "../src/bridges/hydra-bridge.js";
import { EightsBridge, type SinkGateRefs } from "../src/bridges/eights-bridge.js";
import { buildN8RefusalTools, registerTools } from "../src/mcp/tools.js";
import { checkSchema } from "../src/inspector/schema-checks.js";
import type { SmithKernel } from "../src/mcp/tools.js";
import { createN8AttestationController } from "../src/n8-attestation.js";

/**
 * AS-GV governance tests — Reflexion-2 pass (sink-level enforcement).
 *
 * Issue 1: strict r.ok===true in hydra-bridge; venom args include candidate_content.
 * Issue 2: sink gate in EightsBridge — all callers (MCP handler, oracle/promotion,
 *          spool replay) covered; ungated entries dropped not replayed.
 * Issue 3: constitutionAttest always compares; public tool passes localHash;
 *          TOCTOU check in sink (recompute vs boot-attested hash).
 * Issue 4: refusal map derived from registerTools — exact name-set (no regression).
 */

// ---------------------------------------------------------------------------
// Bridge internals helpers
// ---------------------------------------------------------------------------
interface HydraInternals {
  client: { call: (tool: string, args: unknown) => Promise<unknown> };
}
interface EightsInternals {
  client: { call: (tool: string, args: unknown) => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// Standard gate refs for tests that need a gated EightsBridge
// ---------------------------------------------------------------------------
function makePassingGate(overrides: Partial<SinkGateRefs> = {}): SinkGateRefs {
  return {
    inspectContent: vi.fn().mockResolvedValue({ outcome: "allow", rationale: "ok", cited_invariants: [] }),
    venomCheck: vi.fn().mockResolvedValue({ ok: true, rationale: "allowed" }),
    constitutionHash: vi.fn().mockReturnValue("a".repeat(64)),
    bootAttestedHash: "a".repeat(64),
    ...overrides,
  };
}

function makeGatedBridge(gate: SinkGateRefs, spoolDir?: string): EightsBridge {
  return new EightsBridge({
    command: "node",
    args: ["--version"],
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    gate,
    ...(spoolDir ? { spoolDir } : {}),
  });
}

// ---------------------------------------------------------------------------
// SmithKernel builder for MCP tool tests
// ---------------------------------------------------------------------------
function makeKernel(overrides: Partial<SmithKernel> = {}): SmithKernel {
  const base: SmithKernel = {
    cfg: {} as any,
    inspector: {
      inspect: vi.fn().mockResolvedValue({
        outcome: "allow",
        rationale: "schema ok",
        cited_invariants: [],
        evidence: [],
        decided_at: new Date().toISOString(),
      }),
      constitutionHash: vi.fn().mockReturnValue("a".repeat(64)),
      invariants: vi.fn().mockReturnValue([]),
    } as any,
    factory: { scaffold: vi.fn() } as any,
    watcher: { recent: vi.fn().mockReturnValue([]) } as any,
    classifier: { classify: vi.fn() } as any,
    replication: { spawn: vi.fn(), teardown: vi.fn(), list: vi.fn().mockReturnValue([]) } as any,
    isolator: { isolate: vi.fn(), release: vi.fn() } as any,
    registry: {
      scan: vi.fn().mockReturnValue({}),
      writeCache: vi.fn(),
      readCache: vi.fn().mockReturnValue(null),
    } as any,
    decisions: { list: vi.fn().mockReturnValue([]), seal: vi.fn() } as any,
    eights: {
      governanceHitlRequest: vi.fn(),
      constitutionAttest: vi.fn(),
      memoryAdd: vi.fn(),
      evolutionPropose: vi.fn().mockResolvedValue({ proposal_id: "p-ok", auto_committed: false }),
      evolutionCommit: vi.fn().mockResolvedValue({ committed: true }),
      governanceHitlList: vi.fn(),
      lookupEnvelopeAttempt: vi.fn(),
    } as any,
    hydra: {
      venomCrossCheck: vi.fn().mockResolvedValue({ ok: true, rationale: "allowed" }),
      squadRegistry: vi.fn().mockResolvedValue([]),
    } as any,
    pp: { startBestOfStage: vi.fn(), bordaCount: vi.fn() } as any,
    consumer: {} as any,
  };
  return { ...base, ...overrides };
}

// ============================================================================
// Issue 1 — strict r.ok===true; no coercion; venom args include candidate_content
// ============================================================================
describe("Issue 1 — HydraBridge: strict r.ok===true, no coercion", () => {
  let bridge: HydraBridge;

  beforeEach(() => {
    bridge = new HydraBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
  });

  it('r.ok = "false" (string) → blocked (ok===true is false)', async () => {
    (bridge as unknown as HydraInternals).client.call = vi.fn().mockResolvedValue({
      ok: "false", rationale: "coerced",
    });
    const r = await bridge.venomCrossCheck("cap", {});
    expect(r.ok).toBe(false);   // "false" !== true
  });

  it('r.ok = 1 (truthy number) → blocked', async () => {
    (bridge as unknown as HydraInternals).client.call = vi.fn().mockResolvedValue({
      ok: 1, rationale: "number truthy",
    });
    const r = await bridge.venomCrossCheck("cap", {});
    expect(r.ok).toBe(false);   // 1 !== true
  });

  it("r.ok = true → allowed", async () => {
    (bridge as unknown as HydraInternals).client.call = vi.fn().mockResolvedValue({
      ok: true, rationale: "approved",
    });
    const r = await bridge.venomCrossCheck("cap", {});
    expect(r.ok).toBe(true);
  });

  it("r.ok missing → blocked", async () => {
    (bridge as unknown as HydraInternals).client.call = vi.fn().mockResolvedValue({
      rationale: "no ok field",
    });
    const r = await bridge.venomCrossCheck("cap", {});
    expect(r.ok).toBe(false);
  });

  it("degraded (throws) → ok:false with degraded marker", async () => {
    (bridge as unknown as HydraInternals).client.call = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await bridge.venomCrossCheck("cap", {});
    expect(r.ok).toBe(false);
    expect("degraded" in r && r.degraded).toBe(true);
  });
});

// ============================================================================
// Issue 2 — EightsBridge sink gate blocks evolutionPropose
// ============================================================================
describe("Issue 2 — EightsBridge sink gate on evolutionPropose", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-sink-"));
  });
  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("Inspector deny at sink → degraded (gate-blocked), zero TheEights calls", async () => {
    const gate = makePassingGate({
      inspectContent: vi.fn().mockResolvedValue({ outcome: "deny", rationale: "N7 violation", cited_invariants: ["N7"] }),
    });
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn();

    const result = await bridge.evolutionPropose({ rid: "r:1", candidate_content: "bad", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toContain("Inspector blocked");
    expect((bridge as unknown as EightsInternals).client.call).not.toHaveBeenCalled();
  });

  it("Inspector escalate at sink → degraded (gate-blocked), zero TheEights calls", async () => {
    const gate = makePassingGate({
      inspectContent: vi.fn().mockResolvedValue({ outcome: "escalate", rationale: "N7 unregistered", cited_invariants: ["N7"] }),
    });
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn();

    const result = await bridge.evolutionPropose({ rid: "r:2", candidate_content: "x", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toContain("Inspector blocked");
    expect((bridge as unknown as EightsInternals).client.call).not.toHaveBeenCalled();
  });

  it("Venom blocked at sink → degraded (gate-blocked), zero TheEights calls", async () => {
    const gate = makePassingGate({
      venomCheck: vi.fn().mockResolvedValue({ ok: false, rationale: "N2 deny" }),
    });
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn();

    const result = await bridge.evolutionPropose({ rid: "r:3", candidate_content: "content", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toContain("N2");
    expect((bridge as unknown as EightsInternals).client.call).not.toHaveBeenCalled();
  });

  it("Venom unreachable (throws) at sink → degraded (gate-blocked), zero TheEights calls", async () => {
    const gate = makePassingGate({
      venomCheck: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn();

    const result = await bridge.evolutionPropose({ rid: "r:4", candidate_content: "content", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((bridge as unknown as EightsInternals).client.call).not.toHaveBeenCalled();
  });

  it("All gates pass → TheEights call is made once", async () => {
    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({ proposal_id: "p-1", auto_committed: false });

    await bridge.evolutionPropose({ rid: "r:5", candidate_content: "good", justification: "j" });

    const proposeCalls = (bridge as unknown as EightsInternals).client.call as ReturnType<typeof vi.fn>;
    const eightsCalls = proposeCalls.mock.calls.filter((c) => c[0] === "eights.evolution.propose");
    expect(eightsCalls.length).toBe(1);
  });
});

// ============================================================================
// Issue 2b — Spool replay runs gate; failing entries are dropped, not replayed
// ============================================================================
describe("Issue 2b — Spool replay: gate-failing entries dropped, not replayed", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-replay-sink-"));
  });
  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("A spool entry that fails the gate is dropped (skipped) and not sent to TheEights", async () => {
    // Pre-seed a spool file with a valid-looking proposal.
    const id = "test-spool-gate-block";
    writeFileSync(
      join(spoolDir, `${id}.json`),
      JSON.stringify({
        id,
        tool: "eights.evolution.propose",
        args: { rid: "r:spool", candidate_content: "injected", justification: "j" },
        spooled_at: new Date().toISOString(),
        reason: "eights-mcp-unavailable",
      }),
      "utf8",
    );

    const gate = makePassingGate({
      // Inspector blocks the replay entry
      inspectContent: vi.fn().mockResolvedValue({ outcome: "deny", rationale: "injected content denied", cited_invariants: ["N2"] }),
    });
    const bridge = makeGatedBridge(gate, spoolDir);
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    const summary = await bridge.replayPendingProposals();

    // Blocked entries count as skipped, not sent
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    // The file should be deleted (dropped, not left for next replay)
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(spoolDir).filter((f: string) => f.endsWith(".json")).length).toBe(0);
    // TheEights was never called
    expect(callMock).not.toHaveBeenCalled();
  });

  it("A spool entry that passes the gate IS sent to TheEights", async () => {
    const id = "test-spool-gate-pass";
    writeFileSync(
      join(spoolDir, `${id}.json`),
      JSON.stringify({
        id,
        tool: "eights.evolution.propose",
        args: { rid: "r:pass", candidate_content: "good content", justification: "j" },
        spooled_at: new Date().toISOString(),
        reason: "eights-mcp-unavailable",
      }),
      "utf8",
    );

    const gate = makePassingGate(); // all pass
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({ proposal_id: "p-r", auto_committed: false });

    const summary = await bridge.replayPendingProposals();

    expect(summary.sent).toBe(1);
    expect(summary.skipped).toBe(0);
  });
});

// ============================================================================
// Issue 2c — oracle/promotion.ts goes through the gated evolutionPropose sink
// ============================================================================
describe("Issue 2c — oracle/promotion path through gated bridge sink", () => {
  it("promote() with a deny-gate bridge → does not reach TheEights", async () => {
    const { promote } = await import("../src/oracle/promotion.js");

    const gate = makePassingGate({
      inspectContent: vi.fn().mockResolvedValue({ outcome: "deny", rationale: "venom class", cited_invariants: ["N2"] }),
    });
    const spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-oracle-sink-"));
    try {
      const bridge = makeGatedBridge(gate, spoolDir);
      const callMock = vi.fn();
      (bridge as unknown as EightsInternals).client.call = callMock;

      const ticket = await promote(
        { draft_id: "d-oracle", content: "bad content", risk_class: "low" },
        { pass: true, rationale: "passed", evaluated_at: new Date().toISOString(), scores: [] },
        bridge,
      );

      // The bridge's sink gate blocks propose → returns degraded → promote returns hitl_pending
      // (promotion.ts catches the degraded result and routes to hitl_pending)
      expect(ticket.status).toBe("hitl_pending");
      expect(callMock).not.toHaveBeenCalled();
    } finally {
      rmSync(spoolDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Issue 3 — constitutionAttest always compares; TOCTOU check
// ============================================================================
describe("Issue 3 — constitutionAttest: mandatory comparison + TOCTOU", () => {
  it("attest with no localHash and no gate → degraded('eights-attest-no-local-hash')", async () => {
    const bridge = new EightsBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      // No gate injected
    });
    // We should get degraded before even calling eights
    (bridge as unknown as EightsInternals).client.call = vi.fn();

    const result = await bridge.constitutionAttest("trace-1");
    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toBe("eights-attest-no-local-hash");
    // Client must NOT have been called
    expect((bridge as unknown as EightsInternals).client.call).not.toHaveBeenCalled();
  });

  it("attest with gate and matching content_hash → valid receipt", async () => {
    const LOCAL_HEX = "b".repeat(64);
    const gate = makePassingGate({
      constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
      bootAttestedHash: LOCAL_HEX,
    });
    const bridge = makeGatedBridge(gate);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      receipt_signature: "sig-ok",
      content_hash: `sha256:${LOCAL_HEX}`,
      consumer: "hydra",
      attested_at: new Date().toISOString(),
      trace_id: "trace-1",
    });

    const result = await bridge.constitutionAttest("trace-1");
    expect("degraded" in result && result.degraded).toBeFalsy();
    expect(result.receipt_id).toBe("sig-ok");
  });

  it("attest with gate but mismatched content_hash → degraded('eights-attest-hash-mismatch')", async () => {
    const LOCAL_HEX = "b".repeat(64);
    const gate = makePassingGate({
      constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
      bootAttestedHash: LOCAL_HEX,
    });
    const bridge = makeGatedBridge(gate);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      receipt_signature: "sig-drift",
      content_hash: `sha256:${"c".repeat(64)}`,  // different
      consumer: "hydra",
      attested_at: new Date().toISOString(),
      trace_id: "trace-1",
    });

    const result = await bridge.constitutionAttest("trace-1");
    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toBe("eights-attest-hash-mismatch");
  });

  it("attest with non-agentsmith consumer → degraded('eights-attest-invalid-consumer') and no bridge call", async () => {
    const LOCAL_HEX = "b".repeat(64);
    const gate = makePassingGate({
      constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
      bootAttestedHash: LOCAL_HEX,
    });
    const bridge = makeGatedBridge(gate);
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    const result = await bridge.constitutionAttest("trace-1", "hydra");
    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toBe("eights-attest-invalid-consumer");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("TOCTOU: constitutionHash() drifted since boot → sink gate blocks evolutionPropose", async () => {
    const BOOT_HASH = "a".repeat(64);
    const DRIFTED_HASH = "d".repeat(64);  // different from boot
    const gate = makePassingGate({
      // Simulates post-boot drift: recomputed hash != bootAttestedHash
      constitutionHash: vi.fn().mockReturnValue(DRIFTED_HASH),
      bootAttestedHash: BOOT_HASH,
    });
    const spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-toctou-"));
    try {
      const bridge = makeGatedBridge(gate, spoolDir);
      const callMock = vi.fn();
      (bridge as unknown as EightsInternals).client.call = callMock;

      const result = await bridge.evolutionPropose({ rid: "r:toctou", candidate_content: "x", justification: "j" });

      expect("degraded" in result && result.degraded).toBe(true);
      expect((result as { reason: string }).reason).toContain("N8");
      expect(callMock).not.toHaveBeenCalled();
    } finally {
      rmSync(spoolDir, { recursive: true, force: true });
    }
  });

  it("public agentsmith.constitution.attest tool calls bridge with only traceId+consumer (no localHash override)", async () => {
    const LOCAL_HEX = "e".repeat(64);
    const kernel = makeKernel({
      inspector: {
        inspect: vi.fn(),
        constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
        invariants: vi.fn().mockReturnValue([]),
      } as any,
      eights: {
        constitutionAttest: vi.fn().mockResolvedValue({ receipt_id: "sig-x", content_hash: `sha256:${LOCAL_HEX}`, hash: `sha256:${LOCAL_HEX}` }),
        evolutionPropose: vi.fn(),
        governanceHitlRequest: vi.fn(),
        memoryAdd: vi.fn(),
        governanceHitlList: vi.fn(),
        lookupEnvelopeAttempt: vi.fn(),
      } as any,
    });

    const tools = registerTools(kernel);
    const attestTool = tools.get("agentsmith.constitution.attest")!;
    await attestTool.handler({ workflow_id: "wf-1" });

    // Verify only 2 args: traceId + optional consumer. No localHash passed by caller.
    // The bridge sources the hash internally from its injected gate.
    expect(kernel.eights.constitutionAttest).toHaveBeenCalledWith("wf-1", undefined);
    // Confirm constitutionHash was NOT called on the inspector at the tools layer
    // (hash responsibility has moved entirely into the bridge's gate).
    expect(kernel.inspector.constitutionHash).not.toHaveBeenCalled();
  });

  it("public agentsmith.constitution.attest schema refuses non-agentsmith consumer values", () => {
    const kernel = makeKernel();
    const tools = registerTools(kernel);
    const attestTool = tools.get("agentsmith.constitution.attest")!;
    expect(attestTool.inputSchema.safeParse({ workflow_id: "wf-1", consumer: "hydra" }).success).toBe(false);
    expect(attestTool.inputSchema.safeParse({ workflow_id: "wf-1", consumer: "agentsmith" }).success).toBe(true);
  });
});

// ============================================================================
// Issue 4 — refusal map derived from registerTools (no regression)
// ============================================================================
describe("Issue 4 — buildN8RefusalTools: exact name-set equality (no regression)", () => {
  it("refusal map has EXACTLY the same tool names as the real tool map", () => {
    const kernel = makeKernel();
    const realTools = registerTools(kernel);
    const refusalTools = buildN8RefusalTools(kernel, () => "test-detail");

    expect(new Set(refusalTools.keys())).toEqual(new Set(realTools.keys()));
  });

  it("every refusal handler returns ok:false, refused:true, detail preserved", async () => {
    const kernel = makeKernel();
    const refusalTools = buildN8RefusalTools(kernel, () => "mismatch-detail");
    for (const [name, tool] of refusalTools) {
      if (name === "agentsmith.constitution.reattest") {
        continue;
      }
      const r = await tool.handler({}) as Record<string, unknown>;
      expect(r["ok"], name).toBe(false);
      expect(r["refused"], name).toBe(true);
      expect((r["reason"] as string), name).toContain("N8");
      expect(r["detail"]).toBe("mismatch-detail");
    }
  });

  it("refusal map schema rejects invalid input (real schema kept, not z.record fallback)", () => {
    const kernel = makeKernel();
    const refusalTools = buildN8RefusalTools(kernel, () => "x");
    const scaffold = refusalTools.get("agentsmith.factory.scaffold")!;
    expect(scaffold.inputSchema.safeParse({}).success).toBe(false);
  });

  it("reattest remains callable in the refusal map and swaps real tools in place on success", async () => {
    const kernel = makeKernel({
      factory: { scaffold: vi.fn().mockResolvedValue({ ok: true }) } as any,
    });
    const tools = new Map();
    const attestation = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce: vi.fn().mockResolvedValue({ cls: "attested", detail: "receipt=sig-ok" }),
      activateRealTools: async () => {
        const real = registerTools(kernel);
        for (const [name, def] of real) tools.set(name, def);
      },
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    });
    kernel.attestation = attestation;
    for (const [name, def] of buildN8RefusalTools(kernel, attestation.getDetail)) {
      tools.set(name, def);
    }

    const before = await tools.get("agentsmith.factory.scaffold")!.handler({});
    expect((before as Record<string, unknown>).refused).toBe(true);

    const reattest = await tools.get("agentsmith.constitution.reattest")!.handler({});
    expect((reattest as Record<string, unknown>).ok).toBe(true);

    await tools.get("agentsmith.factory.scaffold")!.handler({
      kind: "agent",
      slug: "smith-test",
      project: "hydra",
    });
    expect(kernel.factory.scaffold).toHaveBeenCalledTimes(1);
  });

  it("reattest returns a terminal refusal on mismatch and keeps the refusal map active", async () => {
    const kernel = makeKernel();
    const tools = new Map();
    const attestation = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce: vi.fn().mockResolvedValue({ cls: "terminal", detail: "degraded: eights-attest-hash-mismatch" }),
      activateRealTools: vi.fn(),
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    });
    kernel.attestation = attestation;
    for (const [name, def] of buildN8RefusalTools(kernel, attestation.getDetail)) {
      tools.set(name, def);
    }

    const result = await tools.get("agentsmith.constitution.reattest")!.handler({});
    expect(result).toMatchObject({
      ok: false,
      refused: true,
      degraded: false,
      status: "terminal",
    });
    expect((result as Record<string, unknown>).detail).toBe(
      "boot attest fail-closed: degraded: eights-attest-hash-mismatch",
    );

    const after = await tools.get("agentsmith.factory.scaffold")!.handler({});
    expect((after as Record<string, unknown>).detail).toBe(
      "boot attest fail-closed: degraded: eights-attest-hash-mismatch",
    );
  });
});

// ============================================================================
// Issue 2 (pass-4) — constitutionAttest: hash internally-sourced, no override
// ============================================================================
describe("Issue 2 (pass-4) — constitutionAttest: internally-sourced hash, caller cannot override", () => {
  it("bridge with gate: attest sources hash from gate and succeeds on match", async () => {
    const LOCAL_HEX = "f".repeat(64);
    const gate = makePassingGate({
      constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
      bootAttestedHash: LOCAL_HEX,
    });
    const bridge = makeGatedBridge(gate);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      receipt_signature: "sig-f",
      content_hash: `sha256:${LOCAL_HEX}`,
      consumer: "hydra",
      attested_at: new Date().toISOString(),
      trace_id: "trace-f",
    });

    const result = await bridge.constitutionAttest("trace-f");
    expect("degraded" in result && result.degraded).toBeFalsy();
    expect(result.receipt_id).toBe("sig-f");
  });

  it("bridge with gate: attest sources hash from gate and fails on mismatch (caller cannot inject matching hash)", async () => {
    const LOCAL_HEX = "f".repeat(64);
    const REMOTE_HEX = "9".repeat(64); // different — mismatch
    const gate = makePassingGate({
      constitutionHash: vi.fn().mockReturnValue(LOCAL_HEX),
      bootAttestedHash: LOCAL_HEX,
    });
    const bridge = makeGatedBridge(gate);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      receipt_signature: "sig-drift",
      content_hash: `sha256:${REMOTE_HEX}`,
      consumer: "hydra",
      attested_at: new Date().toISOString(),
      trace_id: "trace-f",
    });

    // Caller passes no hash — bridge uses gate internally; mismatch → degraded
    const result = await bridge.constitutionAttest("trace-f");
    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toBe("eights-attest-hash-mismatch");
  });

  it("bridge WITHOUT gate: attest degrades immediately (eights-attest-no-local-hash), client never called", async () => {
    const bridge = new EightsBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      // No gate — no internal hash source
    });
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    // Even if a caller passes a hash argument, it is silently dropped by the
    // new signature; the bridge has no gate and must degrade.
    const result = await bridge.constitutionAttest("trace-f");
    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toBe("eights-attest-no-local-hash");
    expect(callMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Issue 1 (pass-4) — EightsBridge built WITHOUT a gate: propose/commit/replay
//   all fail CLOSED; zero TheEights calls.
// ============================================================================
describe("Issue 1 (pass-4) — no-gate bridge fails CLOSED on propose/commit/replay", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-nogate-"));
  });
  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("evolutionPropose without gate → degraded (fail-closed), zero TheEights calls", async () => {
    const bridge = new EightsBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      spoolDir,
      // No gate
    });
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    const result = await bridge.evolutionPropose({ rid: "r:nogate", candidate_content: "x", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toMatch(/N2\/N7 sink gate not configured/);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("evolutionCommit without gate → degraded (fail-closed), zero TheEights calls", async () => {
    const bridge = new EightsBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      spoolDir,
    });
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    const result = await bridge.evolutionCommit({ proposal_id: "p-nogate" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { reason: string }).reason).toMatch(/N2\/N7 sink gate not configured/);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("replayPendingProposals without gate → skips all entries, zero TheEights calls", async () => {
    // Pre-seed a spool entry
    const id = "test-nogate-replay";
    writeFileSync(
      join(spoolDir, `${id}.json`),
      JSON.stringify({
        id,
        tool: "eights.evolution.propose",
        args: { rid: "r:nogate-replay", candidate_content: "x", justification: "j" },
        spooled_at: new Date().toISOString(),
        reason: "eights-mcp-unavailable",
      }),
      "utf8",
    );

    const bridge = new EightsBridge({
      command: "node", args: ["--version"],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      spoolDir,
    });
    const callMock = vi.fn();
    (bridge as unknown as EightsInternals).client.call = callMock;

    const summary = await bridge.replayPendingProposals();

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(callMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Issue 3 (pass-4) — downstream degraded responses and strict boolean coercion
// ============================================================================
describe("Issue 3 (pass-4) — downstream degraded responses + strict boolean coercion", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "agentsmith-degraded-"));
  });
  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("evolutionPropose: downstream {degraded:true} → not counted as committed; spool entry written; auto_committed=false", async () => {
    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    // TheEights MCP returns a degraded response body (not a transport error)
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      degraded: true,
      reason: "eights-internal-error",
    });

    const result = await bridge.evolutionPropose({ rid: "r:downstream-deg", candidate_content: "x", justification: "j" });

    expect("degraded" in result && result.degraded).toBe(true);
    // auto_committed must be false — degraded is not success
    expect((result as { auto_committed: boolean }).auto_committed).toBe(false);
    // Spool file should be written (entry queued for retry)
    const { readdirSync } = await import("node:fs");
    const spoolFiles = readdirSync(spoolDir).filter((f: string) => f.endsWith(".json"));
    expect(spoolFiles.length).toBe(1);
  });

  it("evolutionCommit: downstream {degraded:true} → not counted as committed", async () => {
    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      degraded: true,
      reason: "eights-internal-error",
    });

    const result = await bridge.evolutionCommit({ proposal_id: "p-downstream-deg" });

    expect("degraded" in result && result.degraded).toBe(true);
    expect((result as { committed: boolean }).committed).toBe(false);
  });

  it("evolutionPropose: auto_committed='false' (string) → auto_committed===false (strict, not coerced)", async () => {
    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      proposal_id: "p-str",
      auto_committed: "false",   // string — Boolean("false") would be true
    });

    const result = await bridge.evolutionPropose({ rid: "r:str-coerce", candidate_content: "x", justification: "j" });

    expect("degraded" in result).toBe(false);
    expect((result as { auto_committed: boolean }).auto_committed).toBe(false);
  });

  it("evolutionCommit: committed='false' (string) → committed===false (strict)", async () => {
    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      committed: "false",
    });

    const result = await bridge.evolutionCommit({ proposal_id: "p-commit-str" });

    expect("degraded" in result).toBe(false);
    expect((result as { committed: boolean }).committed).toBe(false);
  });

  it("replayPendingProposals: downstream {degraded:true} → entry NOT deleted, counted as failed", async () => {
    const id = "test-replay-downstream-deg";
    writeFileSync(
      join(spoolDir, `${id}.json`),
      JSON.stringify({
        id,
        tool: "eights.evolution.propose",
        args: { rid: "r:replay-deg", candidate_content: "x", justification: "j" },
        spooled_at: new Date().toISOString(),
        reason: "eights-mcp-unavailable",
      }),
      "utf8",
    );

    const gate = makePassingGate();
    const bridge = makeGatedBridge(gate, spoolDir);
    // TheEights returns a degraded body — transport did not fail but result is not success
    (bridge as unknown as EightsInternals).client.call = vi.fn().mockResolvedValue({
      degraded: true,
      reason: "eights-internal-error",
    });

    const summary = await bridge.replayPendingProposals();

    // counted as failed, NOT sent
    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
    // File must still be present (not deleted — it is queued for next retry)
    const { readdirSync } = await import("node:fs");
    const spoolFiles = readdirSync(spoolDir).filter((f: string) => f.endsWith(".json"));
    expect(spoolFiles.length).toBe(1);
  });
});

// ============================================================================
// AS-GV-5 — schema-checker escalates with N7 (no regression)
// ============================================================================
describe("AS-GV-5 — schema-checker N7 escalate (no regression)", () => {
  it("does not return the old fail-open allow pass", () => {
    const result = checkSchema({ kind: "rubric", content: "---\nname: test\n---\nbody" });
    if (result.outcome === "allow" && result.rationale.includes("no schema registered")) {
      expect.fail("schema-checker still failing open");
    }
    if (result.outcome === "escalate") {
      expect(result.cited_invariants).toContain("N7");
    }
  });
});
