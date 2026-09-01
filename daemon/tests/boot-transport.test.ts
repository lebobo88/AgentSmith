import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startHydraTail } from "../src/sentinel/hydra-tail.js";
import { selectTailTargets, type TailCandidate } from "../src/sentinel/tail-budget.js";
import { buildN8RefusalTools } from "../src/mcp/tools.js";
import { createN8AttestationController, type N8AttestationSnapshot } from "../src/n8-attestation.js";
import type { SmithKernel } from "../src/mcp/tools.js";

// ===========================================================================
// E2-10 — boot attest must never block the MCP transport.
//
// Root cause: startHydraTail's boot scan was synchronous and unbounded. On a
// mature install (~16.5k workflow dirs under <Hydra>/.hydra) it blocked the
// event loop for ~29s and left ~16.5k per-file poll timers running, so the MCP
// `initialize` frame sat unread and the daemon looked unreachable / dropped
// pooled connections.
// ===========================================================================

const here = dirname(fileURLToPath(import.meta.url));
const daemonRoot = join(here, "..");

function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// selectTailTargets — the budget itself
// ---------------------------------------------------------------------------
describe("E2-10 selectTailTargets", () => {
  const budget = { maxFiles: 2, maxAgeMs: 60_000 };
  const now = 1_000_000;

  const candidate = (name: string, ageMs: number): TailCandidate => ({
    path: `/x/${name}`,
    scope: name,
    mtimeMs: now - ageMs,
  });

  it("keeps only the freshest maxFiles candidates", () => {
    const picked = selectTailTargets(
      [candidate("a", 30_000), candidate("b", 1_000), candidate("c", 10_000)],
      budget,
      new Set(),
      now,
    );
    expect(picked.map((p) => p.scope)).toEqual(["b", "c"]);
  });

  it("drops candidates older than maxAgeMs even when under the count cap", () => {
    const picked = selectTailTargets([candidate("stale", 600_000)], budget, new Set(), now);
    expect(picked).toEqual([]);
  });

  it("never drops an already-attached tail (no silent blinding)", () => {
    const attached = new Set(["/x/stale"]);
    const picked = selectTailTargets(
      [candidate("stale", 600_000), candidate("fresh", 100)],
      budget,
      attached,
      now,
    );
    expect(picked.map((p) => p.scope)).toContain("stale");
  });
});

// ---------------------------------------------------------------------------
// startHydraTail — non-blocking + bounded
// ---------------------------------------------------------------------------
describe("E2-10 startHydraTail does not block the event loop", () => {
  const WORKFLOW_COUNT = 800;
  let root = "";

  beforeAll(() => {
    root = scratchDir("agentsmith-hydra-tail-");
    for (let i = 0; i < WORKFLOW_COUNT; i++) {
      const dir = join(root, `wf_${i}`);
      mkdirSync(dir);
      writeFileSync(join(dir, "trace.jsonl"), "", "utf8");
    }
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns immediately and lets timers fire on schedule", async () => {
    const started = Date.now();
    const tail = startHydraTail(() => undefined, { hydraRoot: root, onError: () => undefined });
    const returnedAfterMs = Date.now() - started;

    const timerFiredAfterMs = await new Promise<number>((resolve) => {
      const t0 = Date.now();
      setTimeout(() => resolve(Date.now() - t0), 50);
    });

    tail.stop();

    // Pre-fix this call alone blocked for seconds (and ~29s on the real
    // ~16.5k-dir root); the 50ms timer then fired seconds late.
    expect(returnedAfterMs).toBeLessThan(300);
    expect(timerFiredAfterMs).toBeLessThan(1000);
  }, 30_000);
});

describe("E2-10 startHydraTail honours the tail budget", () => {
  let root = "";
  const tails: Array<{ stop: () => void }> = [];

  afterEach(() => {
    while (tails.length) tails.pop()!.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("tails only the freshest maxFiles traces and ignores stale ones", async () => {
    root = scratchDir("agentsmith-hydra-budget-");
    const stale = join(root, "wf_stale");
    const freshA = join(root, "wf_fresh_a");
    const freshB = join(root, "wf_fresh_b");
    for (const dir of [stale, freshA, freshB]) {
      mkdirSync(dir);
      writeFileSync(join(dir, "trace.jsonl"), "", "utf8");
    }
    // Age the stale trace well past the age budget.
    const old = Date.now() / 1000 - 7 * 24 * 60 * 60;
    utimesSync(join(stale, "trace.jsonl"), old, old);

    const scopes: string[] = [];
    const tail = startHydraTail((evt) => scopes.push(evt.scope ?? ""), {
      hydraRoot: root,
      maxFiles: 2,
      maxAgeMs: 60_000,
      onError: () => undefined,
    });
    tails.push(tail);

    // Let the async scan attach.
    await new Promise((r) => setTimeout(r, 500));
    for (const dir of [stale, freshA, freshB]) {
      appendFileSync(join(dir, "trace.jsonl"), JSON.stringify({ level: "info", dir }) + "\n", "utf8");
    }
    await new Promise((r) => setTimeout(r, 2500));

    expect(scopes).toContain("wf_fresh_a");
    expect(scopes).toContain("wf_fresh_b");
    expect(scopes).not.toContain("wf_stale");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// not_ready vs refused
// ---------------------------------------------------------------------------
function stubKernel(): SmithKernel {
  return {
    cfg: {} as never,
    inspector: {} as never,
    factory: {} as never,
    watcher: {} as never,
    classifier: {} as never,
    replication: {} as never,
    isolator: {} as never,
    registry: {} as never,
    decisions: {} as never,
    eights: {} as never,
    hydra: {} as never,
    pp: {} as never,
    consumer: {} as never,
  } as unknown as SmithKernel;
}

function snapshot(mode: N8AttestationSnapshot["mode"], detail: string): N8AttestationSnapshot {
  return { mode, attempt: 1, detail, retry_after_s: mode === "retrying" ? 3 : 0 };
}

describe("E2-10 N8 gate distinguishes not_ready from refused", () => {
  it("returns a structured not_ready while boot attest is pending", async () => {
    const tools = buildN8RefusalTools(stubKernel(), () => snapshot("retrying", "boot attest pending"));
    const tool = tools.get("agentsmith.constitution.get")!;
    const result = (await tool.handler({})) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: false,
      status: "not_ready",
      reason: "boot attest pending",
      retry_after_s: 3,
    });
    // "not yet" is NOT a constitutional refusal.
    expect(result["refused"]).toBeUndefined();
  });

  it("keeps refused:true for a genuine attest MISMATCH (N8 unchanged)", async () => {
    const tools = buildN8RefusalTools(
      stubKernel(),
      () => snapshot("terminal", "boot attest fail-closed: degraded: eights-attest-hash-mismatch"),
    );
    for (const [name, tool] of tools) {
      if (name === "agentsmith.constitution.reattest") continue;
      const result = (await tool.handler({})) as Record<string, unknown>;
      expect(result["ok"], name).toBe(false);
      expect(result["refused"], name).toBe(true);
      expect(String(result["reason"]), name).toContain("N8");
      expect(result["status"], name).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// reattest must always answer, and must not wedge the session
// ---------------------------------------------------------------------------
describe("E2-10 reattest keeps the session alive", () => {
  const silentLog = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });

  it("answers not_ready inside its budget when the attest attempt hangs, and stays callable", async () => {
    let resolveAttest: (() => void) | undefined;
    const attestOnce = vi.fn().mockImplementation(
      () => new Promise<never>(() => {
        resolveAttest = () => undefined;
      }),
    );
    const controller = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce,
      activateRealTools: vi.fn(),
      log: silentLog(),
      reattestBudgetMs: 50,
    });

    const started = Date.now();
    const first = (await controller.reattest()) as Record<string, unknown>;
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(first).toMatchObject({ ok: false, status: "not_ready", reason: "boot attest pending" });
    expect(first["refused"]).toBeUndefined();

    // The session survives: a second call still answers rather than throwing.
    const second = (await controller.reattest()) as Record<string, unknown>;
    expect(second["status"]).toBe("not_ready");
    expect(resolveAttest === undefined || typeof resolveAttest === "function").toBe(true);
  }, 15_000);

  it("answers not_ready (never refused) when TheEights is unreachable", async () => {
    const controller = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce: vi.fn().mockResolvedValue({ cls: "transport", detail: "degraded: eights-mcp-unavailable" }),
      activateRealTools: vi.fn(),
      log: silentLog(),
    });

    const result = (await controller.reattest()) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, status: "not_ready", degraded: true, attested: false });
    expect(result["refused"]).toBeUndefined();
    expect(Number(result["retry_after_s"])).toBeGreaterThan(0);
  });

  it("still returns the terminal N8 refusal on a hash mismatch", async () => {
    const controller = createN8AttestationController({
      hash: "a".repeat(64),
      bootAttempts: 1,
      attestOnce: vi.fn().mockResolvedValue({ cls: "terminal", detail: "degraded: eights-attest-hash-mismatch" }),
      activateRealTools: vi.fn(),
      log: silentLog(),
    });

    const result = (await controller.reattest()) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, refused: true, degraded: false, status: "terminal" });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real stdio handshake with TheEights unreachable
// ---------------------------------------------------------------------------
describe("E2-10 MCP handshake with TheEights unreachable", () => {
  const distEntry = join(daemonRoot, "dist", "index.js");
  const built = existsSync(distEntry);

  it.runIf(built)(
    "completes initialize + first tool call in under 5s and reattest keeps the transport alive",
    async () => {
      // Consumer base with NO TheEights checkout — the eights bridge child
      // cannot start, so boot attest can never complete.
      const consumerBase = scratchDir("agentsmith-e2e-base-");
      const home = scratchDir("agentsmith-e2e-home-");
      mkdirSync(join(consumerBase, "Hydra", ".hydra"), { recursive: true });

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      env["AGENTSMITH_CONSUMER_BASE"] = consumerBase;
      env["AGENTSMITH_HOME"] = home;
      env["AGENTSMITH_BRIDGE_SINGLETON_DIR"] = join(home, "bridge-singletons");

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [distEntry],
        env,
        stderr: "ignore",
      });
      const client = new Client({ name: "e2-10-test", version: "0.0.1" }, { capabilities: {} });

      try {
        const t0 = Date.now();
        await client.connect(transport);
        const initializeMs = Date.now() - t0;

        const listed = await client.listTools({});
        const first = await client.callTool({
          name: "agentsmith.constitution.get",
          arguments: {},
        });
        const firstCallMs = Date.now() - t0;

        expect(initializeMs).toBeLessThan(5000);
        expect(firstCallMs).toBeLessThan(5000);
        expect(listed.tools.length).toBeGreaterThan(0);

        const firstBody = JSON.parse(
          (first as { content: Array<{ text: string }> }).content[0]!.text,
        ) as Record<string, unknown>;
        expect(firstBody["status"]).toBe("not_ready");
        expect(firstBody["refused"]).toBeUndefined();

        // reattest must not end the process or close the stdio transport.
        await client.callTool({ name: "agentsmith.constitution.reattest", arguments: {} });
        const after = await client.callTool({
          name: "agentsmith.constitution.get",
          arguments: {},
        });
        const afterBody = JSON.parse(
          (after as { content: Array<{ text: string }> }).content[0]!.text,
        ) as Record<string, unknown>;
        expect(afterBody["status"]).toBe("not_ready");
      } finally {
        await client.close().catch(() => undefined);
        rmSync(consumerBase, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
