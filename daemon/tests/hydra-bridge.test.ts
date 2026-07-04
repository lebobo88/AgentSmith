import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HydraBridge } from "../src/bridges/hydra-bridge.js";

/**
 * Phase 3d — HydraBridge spawn-target tests.
 *
 * Verifies:
 *   (a) Default spawn args use `mcp_servers.hydra_control`, not `executive_suite`.
 *   (b) `AGENTSMITH_HYDRA_BRIDGE_MODULE` env var overrides the default module.
 *   (c) Explicit `opts.args` take precedence over both env and default.
 *   (d) venomCrossCheck happy path: stubbed {ok:true, rationale} → ok===true strictly.
 *   (e) venomCrossCheck degrades fail-closed when the server is unreachable (throws).
 *   (f) venomCrossCheck degrades fail-closed when the server returns an error body.
 *
 * All tests stub the internal McpClient.call so no real Python process is spawned.
 * Spawn-args assertions read the McpClient.cfg field via a typed cast (the field
 * is private in TypeScript but accessible at runtime).
 */

/** Cast surface to read McpClient internals without spawning a real process. */
interface HydraInternals {
  client: {
    cfg: { command: string; args: string[] };
    call: (tool: string, args: unknown) => Promise<unknown>;
  };
}

function asInternals(bridge: HydraBridge): HydraInternals {
  return bridge as unknown as HydraInternals;
}

/** Shared stub logger — keeps test output clean. */
function makeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// (a) Default spawn target is hydra_control
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: default spawn target", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    // Ensure the env override is not set so we see the real default.
    savedEnv = process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
    delete process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
    } else {
      process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = savedEnv;
    }
  });

  it("default args spawn python -m mcp_servers.hydra_control", () => {
    const bridge = new HydraBridge({ command: "python", logger: makeLogger() });
    const { args } = asInternals(bridge).client.cfg;
    expect(args).toEqual(["-m", "mcp_servers.hydra_control"]);
  });

  it("default args do NOT spawn executive_suite", () => {
    const bridge = new HydraBridge({ command: "python", logger: makeLogger() });
    const { args } = asInternals(bridge).client.cfg;
    expect(args.join(" ")).not.toContain("executive_suite");
  });

  it("default command is python", () => {
    const bridge = new HydraBridge({ logger: makeLogger() });
    const { command } = asInternals(bridge).client.cfg;
    expect(command).toBe("python");
  });
});

// ---------------------------------------------------------------------------
// (b) AGENTSMITH_HYDRA_BRIDGE_MODULE env var overrides the default
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: AGENTSMITH_HYDRA_BRIDGE_MODULE override", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
    } else {
      process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = savedEnv;
    }
  });

  it("env var changes the spawned module", () => {
    process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = "mcp_servers.custom_control";
    const bridge = new HydraBridge({ command: "python", logger: makeLogger() });
    const { args } = asInternals(bridge).client.cfg;
    expect(args).toEqual(["-m", "mcp_servers.custom_control"]);
  });

  it("whitespace-only env var falls back to default", () => {
    process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = "   ";
    const bridge = new HydraBridge({ command: "python", logger: makeLogger() });
    const { args } = asInternals(bridge).client.cfg;
    expect(args).toEqual(["-m", "mcp_servers.hydra_control"]);
  });

  it("empty string env var falls back to default", () => {
    process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = "";
    const bridge = new HydraBridge({ command: "python", logger: makeLogger() });
    const { args } = asInternals(bridge).client.cfg;
    expect(args).toEqual(["-m", "mcp_servers.hydra_control"]);
  });
});

// ---------------------------------------------------------------------------
// (c) Explicit opts.args take precedence over env and default
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: explicit opts.args wins over env", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
    // Set env var — explicit opts.args must still win.
    process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = "mcp_servers.should_be_ignored";
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"];
    } else {
      process.env["AGENTSMITH_HYDRA_BRIDGE_MODULE"] = savedEnv;
    }
  });

  it("opts.args override env var", () => {
    const bridge = new HydraBridge({
      command: "python",
      args: ["-m", "mcp_servers.test_override"],
      logger: makeLogger(),
    });
    const { args } = asInternals(bridge).client.cfg;
    expect(args).toEqual(["-m", "mcp_servers.test_override"]);
  });
});

// ---------------------------------------------------------------------------
// (d) venomCrossCheck happy path
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: venomCrossCheck happy path", () => {
  it("returns ok===true and rationale when hydra.venom.cross_check responds {ok:true, rationale}", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockResolvedValue({
      ok: true,
      rationale: "cross-check approved",
    });

    const result = await bridge.venomCrossCheck("agent-scaffold", { slug: "smith-test" });

    expect(result.ok).toBe(true);
    expect(result.rationale).toBe("cross-check approved");
    expect("degraded" in result && result.degraded).toBeFalsy();
  });

  it("calls hydra.venom.cross_check with the correct tool name and args", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    const callMock = vi.fn().mockResolvedValue({ ok: true, rationale: "approved" });
    asInternals(bridge).client.call = callMock;

    await bridge.venomCrossCheck("lateral-movement", { target: "agentsmith" });

    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith("hydra.venom.cross_check", {
      capability: "lateral-movement",
      args: { target: "agentsmith" },
    });
  });

  it("rationale defaults to empty string when hydra omits it", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockResolvedValue({ ok: true });

    const result = await bridge.venomCrossCheck("cap", {});
    expect(result.ok).toBe(true);
    expect(result.rationale).toBe("");
  });
});

// ---------------------------------------------------------------------------
// (e) venomCrossCheck degrades fail-closed when the server is unreachable
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: venomCrossCheck fail-closed on unreachable server", () => {
  it("returns ok===false with degraded marker when the server throws", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockRejectedValue(new Error("ECONNREFUSED: hydra unreachable"));

    const result = await bridge.venomCrossCheck("cap", {});

    expect(result.ok).toBe(false);
    expect("degraded" in result && result.degraded).toBe(true);
    expect(result.rationale).toContain("failing CLOSED");
  });

  it("degraded reason is hydra-mcp-unavailable", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockRejectedValue(new Error("EPIPE"));

    const result = await bridge.venomCrossCheck("cap", {});

    expect((result as { reason?: string }).reason).toBe("hydra-mcp-unavailable");
  });
});

// ---------------------------------------------------------------------------
// (f) venomCrossCheck degrades fail-closed on error body (non-boolean ok)
// ---------------------------------------------------------------------------
describe("Phase 3d — HydraBridge: venomCrossCheck fail-closed on error body", () => {
  it("ok===null in response → ok false (no degraded marker, but denied)", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockResolvedValue({ ok: null, rationale: "denied" });

    const result = await bridge.venomCrossCheck("cap", {});
    expect(result.ok).toBe(false);
    // Not a transport degraded — the server responded; no degraded marker expected
    expect("degraded" in result).toBe(false);
  });

  it("ok===false in response → denied (strict boolean)", async () => {
    const bridge = new HydraBridge({ command: "python", args: ["--version"], logger: makeLogger() });
    asInternals(bridge).client.call = vi.fn().mockResolvedValue({ ok: false, rationale: "N2 venom class" });

    const result = await bridge.venomCrossCheck("cap", {});
    expect(result.ok).toBe(false);
    expect(result.rationale).toBe("N2 venom class");
  });
});
