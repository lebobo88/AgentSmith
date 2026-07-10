import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpClient,
  claimSingletonLease,
  reapSingletonLease,
  releaseSingletonLease,
  singletonLeasePath,
} from "../src/bridges/mcp-client.js";

// ---------------------------------------------------------------------------
// McpClient connect-timeout resolution — RA-6
//
// Rules:
//   • cfg.name === "hydra"  → AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS  (default 15000)
//   • cfg.name === "eights" → AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS (default 20000)
//   • any other name        → 2000 (hard-coded)
//   • cfg.connectTimeoutMs explicit override wins over all defaults
// ---------------------------------------------------------------------------

/** Read the private connectTimeoutMs without spawning a real child process. */
function readTimeout(client: McpClient): number {
  return (client as unknown as { connectTimeoutMs: number }).connectTimeoutMs;
}

/** Minimal logger that keeps test output silent. */
function silentLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

/** Minimal config that does NOT trigger a real spawn (no connect() called). */
function cfg(name: string, overrides: { connectTimeoutMs?: number } = {}) {
  return { name, command: "node", args: ["--version"], ...overrides };
}

describe("McpClient connect-timeout resolution", () => {
  // Save and restore env vars touched by these tests.
  let savedHydra: string | undefined;
  let savedEights: string | undefined;

  beforeEach(() => {
    savedHydra = process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"];
    savedEights = process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"];
    delete process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"];
    delete process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"];
  });

  afterEach(() => {
    if (savedHydra === undefined) {
      delete process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"];
    } else {
      process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"] = savedHydra;
    }
    if (savedEights === undefined) {
      delete process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"];
    } else {
      process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"] = savedEights;
    }
  });

  it("hydra bridge defaults to 15000 ms when env var is absent", () => {
    const client = new McpClient(cfg("hydra"), silentLogger());
    expect(readTimeout(client)).toBe(15000);
  });

  it("hydra bridge reads AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS from env", () => {
    process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"] = "8000";
    const client = new McpClient(cfg("hydra"), silentLogger());
    expect(readTimeout(client)).toBe(8000);
  });

  it("hydra explicit cfg.connectTimeoutMs overrides the env default", () => {
    process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"] = "8000";
    const client = new McpClient(cfg("hydra", { connectTimeoutMs: 999 }), silentLogger());
    expect(readTimeout(client)).toBe(999);
  });

  it("eights bridge defaults to 20000 ms when env var is absent", () => {
    const client = new McpClient(cfg("eights"), silentLogger());
    expect(readTimeout(client)).toBe(20000);
  });

  it("eights bridge reads AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS from env", () => {
    process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"] = "5000";
    const client = new McpClient(cfg("eights"), silentLogger());
    expect(readTimeout(client)).toBe(5000);
  });

  it("other bridges default to 2000 ms", () => {
    for (const name of ["pp", "executive", "unknown-bridge"]) {
      const client = new McpClient(cfg(name), silentLogger());
      expect(readTimeout(client), `bridge '${name}'`).toBe(2000);
    }
  });

  it("other bridges respect explicit cfg.connectTimeoutMs override", () => {
    const client = new McpClient(cfg("pp", { connectTimeoutMs: 4500 }), silentLogger());
    expect(readTimeout(client)).toBe(4500);
  });
});

describe("McpClient singleton lease reaping", () => {
  const singletonKey = "eights-stdio-daemon";
  const expected = {
    command: "node",
    args: ["C:/AiAppDeployments/TheEights/daemon/dist/index.js"],
  };

  let scratch = "";
  let priorDir: string | undefined;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "agentsmith-singleton-"));
    priorDir = process.env["AGENTSMITH_BRIDGE_SINGLETON_DIR"];
    process.env["AGENTSMITH_BRIDGE_SINGLETON_DIR"] = scratch;
  });

  afterEach(() => {
    if (priorDir === undefined) {
      delete process.env["AGENTSMITH_BRIDGE_SINGLETON_DIR"];
    } else {
      process.env["AGENTSMITH_BRIDGE_SINGLETON_DIR"] = priorDir;
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  it("reaps a matching stale child and clears the lease", async () => {
    const killProcessTree = vi.fn().mockResolvedValue(true);
    claimSingletonLease(singletonKey, {
      pid: 4242,
      command: expected.command,
      args: expected.args,
      claimed_at: new Date().toISOString(),
    });

    const result = await reapSingletonLease(
      singletonKey,
      expected,
      { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      {
        isProcessAlive: vi.fn().mockReturnValue(true),
        getProcessCommandLine: vi.fn().mockResolvedValue(
          `node ${expected.args[0]} --stdio`,
        ),
        killProcessTree,
      },
    );

    expect(result).toEqual({
      action: "reaped",
      reason: "stale-child-reaped",
      pid: 4242,
    });
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(existsSync(singletonLeasePath(singletonKey))).toBe(false);
  });

  it("clears the lease without killing when the recorded pid now belongs to another process", async () => {
    const killProcessTree = vi.fn().mockResolvedValue(true);
    claimSingletonLease(singletonKey, {
      pid: 5151,
      command: expected.command,
      args: expected.args,
      claimed_at: new Date().toISOString(),
    });

    const result = await reapSingletonLease(
      singletonKey,
      expected,
      { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      {
        isProcessAlive: vi.fn().mockReturnValue(true),
        getProcessCommandLine: vi.fn().mockResolvedValue("powershell.exe -NoProfile"),
        killProcessTree,
      },
    );

    expect(result).toEqual({
      action: "cleared",
      reason: "pid-command-mismatch",
      pid: 5151,
    });
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(existsSync(singletonLeasePath(singletonKey))).toBe(false);
  });

  it("only releases the lease when the pid matches the current child", () => {
    claimSingletonLease(singletonKey, {
      pid: 6262,
      command: expected.command,
      args: expected.args,
      claimed_at: new Date().toISOString(),
    });

    releaseSingletonLease(singletonKey, 9999);
    expect(existsSync(singletonLeasePath(singletonKey))).toBe(true);

    releaseSingletonLease(singletonKey, 6262);
    expect(existsSync(singletonLeasePath(singletonKey))).toBe(false);
  });
});
