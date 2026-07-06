/**
 * McpClient — a small, defensive wrapper around the MCP SDK stdio Client.
 *
 * Used by AgentSmith's bridges (eights, hydra, pp) to call OTHER MCP servers
 * as a child process. Every public method swallows transport errors and degrades
 * politely; nothing here ever throws to the caller.
 *
 * Connect attempts are capped (default 2s). Broken-pipe / closed-transport errors
 * trigger a lazy reconnect on the next call.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface McpServerConfig {
  /** Human-readable label, used in logs and as the client.name. */
  name: string;
  /** Executable to spawn (e.g. "node", "python"). */
  command: string;
  /** Arguments to the executable. */
  args: string[];
  /** Optional environment overlay (merged onto process.env). */
  env?: Record<string, string>;
  /** Optional cwd. */
  cwd?: string;
  /** Connect timeout in ms (default 2000). */
  connectTimeoutMs?: number;
  /** Optional singleton lease key for child-process orphan reaping. */
  singletonKey?: string;
}

export interface BridgeLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  info?: (obj: Record<string, unknown>, msg?: string) => void;
  debug?: (obj: Record<string, unknown>, msg?: string) => void;
}

const consoleLogger: BridgeLogger = {
  warn: (obj, msg) => {
    // eslint-disable-next-line no-console
    console.error(`[mcp-client] WARN ${msg ?? ""}`, JSON.stringify(obj));
  },
  error: (obj, msg) => {
    // eslint-disable-next-line no-console
    console.error(`[mcp-client] ERROR ${msg ?? ""}`, JSON.stringify(obj));
  },
};

interface CallToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface SingletonLease {
  pid: number;
  command: string;
  args: string[];
  cwd?: string;
  claimed_at: string;
}

interface SingletonOps {
  isProcessAlive: (pid: number) => boolean;
  getProcessCommandLine: (pid: number) => string | null;
  killProcessTree: (pid: number) => boolean;
}

export interface SingletonReapResult {
  action: "none" | "cleared" | "reaped" | "skipped";
  reason: string;
  pid?: number;
}

const defaultSingletonOps: SingletonOps = {
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  getProcessCommandLine: (pid) => {
    try {
      if (process.platform === "win32") {
        const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { [Console]::Out.Write($p.CommandLine) }`;
        return execFileSync(
          "powershell",
          ["-NoProfile", "-NonInteractive", "-Command", script],
          { encoding: "utf8", windowsHide: true, timeout: 2000 },
        ).trim() || null;
      }
      return execFileSync(
        "ps",
        ["-p", String(pid), "-o", "args="],
        { encoding: "utf8", timeout: 2000 },
      ).trim() || null;
    } catch {
      return null;
    }
  },
  killProcessTree: (pid) => {
    try {
      if (process.platform === "win32") {
        const result = spawnSync(
          "taskkill",
          ["/PID", String(pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true, timeout: 5000 },
        );
        return result.status === 0;
      }
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  },
};

function singletonLeaseDir(): string {
  return process.env["AGENTSMITH_BRIDGE_SINGLETON_DIR"] ?? join(homedir(), ".agentsmith", "bridge-singletons");
}

export function singletonLeasePath(key: string): string {
  return join(singletonLeaseDir(), `${key}.json`);
}

function readSingletonLease(key: string): SingletonLease | null {
  try {
    const raw = readFileSync(singletonLeasePath(key), "utf8");
    const parsed = JSON.parse(raw) as Partial<SingletonLease>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.command !== "string" ||
      !Array.isArray(parsed.args)
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      command: parsed.command,
      args: parsed.args.map((value) => String(value)),
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      claimed_at: typeof parsed.claimed_at === "string" ? parsed.claimed_at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizeCommandFragment(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function commandLineMatchesLease(commandLine: string, lease: Pick<SingletonLease, "command" | "args">): boolean {
  const haystack = normalizeCommandFragment(commandLine);
  const fragments = [lease.command, ...lease.args]
    .map((value) => normalizeCommandFragment(value))
    .filter((value) => value.length > 0);
  return fragments.every((fragment) => haystack.includes(fragment));
}

export function claimSingletonLease(key: string, lease: SingletonLease): void {
  const path = singletonLeasePath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(lease, null, 2), "utf8");
}

export function releaseSingletonLease(key: string, pid?: number | null): void {
  const path = singletonLeasePath(key);
  if (!existsSync(path)) return;
  if (pid === undefined || pid === null) {
    rmSync(path, { force: true });
    return;
  }

  const lease = readSingletonLease(key);
  if (!lease || lease.pid === pid) {
    rmSync(path, { force: true });
  }
}

export function reapSingletonLease(
  key: string,
  expected: Pick<SingletonLease, "command" | "args">,
  log: BridgeLogger = consoleLogger,
  ops: Partial<SingletonOps> = {},
): SingletonReapResult {
  const lease = readSingletonLease(key);
  if (!lease) {
    releaseSingletonLease(key);
    return { action: "none", reason: "no-lease" };
  }

  const runtime: SingletonOps = { ...defaultSingletonOps, ...ops };
  if (!runtime.isProcessAlive(lease.pid)) {
    releaseSingletonLease(key, lease.pid);
    return { action: "cleared", reason: "process-not-alive", pid: lease.pid };
  }

  const commandLine = runtime.getProcessCommandLine(lease.pid);
  if (!commandLine) {
    log.warn(
      { bridge: key, pid: lease.pid },
      "singleton lease could not confirm command line; leaving prior process in place",
    );
    return { action: "skipped", reason: "command-line-unavailable", pid: lease.pid };
  }

  if (!commandLineMatchesLease(commandLine, lease)) {
    releaseSingletonLease(key, lease.pid);
    return { action: "cleared", reason: "pid-command-mismatch", pid: lease.pid };
  }

  if (!commandLineMatchesLease(commandLine, expected)) {
    log.warn(
      { bridge: key, pid: lease.pid, commandLine },
      "singleton lease command line did not match the expected bridge target; reaping recorded stale child anyway",
    );
  }

  if (!runtime.killProcessTree(lease.pid)) {
    log.warn(
      { bridge: key, pid: lease.pid },
      "singleton lease matched a stale child but the reap failed",
    );
    return { action: "skipped", reason: "kill-failed", pid: lease.pid };
  }

  releaseSingletonLease(key, lease.pid);
  return { action: "reaped", reason: "stale-child-reaped", pid: lease.pid };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout(${ms}ms): ${label}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly cfg: McpServerConfig,
    private readonly log: BridgeLogger = consoleLogger,
  ) {
    let defaultConnectTimeoutMs: number;
    if (cfg.name === "eights") {
      defaultConnectTimeoutMs = Number(process.env["AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS"] ?? 20000);
    } else if (cfg.name === "hydra") {
      defaultConnectTimeoutMs = Number(process.env["AGENTSMITH_HYDRA_CONNECT_TIMEOUT_MS"] ?? 15000);
    } else {
      defaultConnectTimeoutMs = 2000;
    }
    this.connectTimeoutMs = cfg.connectTimeoutMs ?? defaultConnectTimeoutMs;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      // Declared outside the try so the catch can tear down a partially-built
      // transport whose child process is already spawned.
      let transport: StdioClientTransport | null = null;
      let client: Client | null = null;
      try {
        if (this.cfg.singletonKey) {
          const reap = reapSingletonLease(
            this.cfg.singletonKey,
            { command: this.cfg.command, args: this.cfg.args },
            this.log,
          );
          if (reap.action === "reaped") {
            this.log.info?.(
              { bridge: this.cfg.name, pid: reap.pid },
              "mcp-client reaped stale singleton child before reconnect",
            );
          }
        }

        const transportEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (typeof v === "string") transportEnv[k] = v;
        }
        if (this.cfg.env) {
          for (const [k, v] of Object.entries(this.cfg.env)) transportEnv[k] = v;
        }
        transport = new StdioClientTransport({
          command: this.cfg.command,
          args: this.cfg.args,
          env: transportEnv,
          ...(this.cfg.cwd ? { cwd: this.cfg.cwd } : {}),
        });
        client = new Client(
          { name: `agentsmith-bridge:${this.cfg.name}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await withTimeout(
          client.connect(transport),
          this.connectTimeoutMs,
          `connect ${this.cfg.name}`,
        );
        if (this.cfg.singletonKey && transport.pid) {
          claimSingletonLease(this.cfg.singletonKey, {
            pid: transport.pid,
            command: this.cfg.command,
            args: [...this.cfg.args],
            cwd: this.cfg.cwd,
            claimed_at: new Date().toISOString(),
          });
        }
        this.transport = transport;
        this.client = client;
      } catch (err) {
        this.log.warn(
          { bridge: this.cfg.name, err: String(err) },
          "mcp-client connect failed",
        );
        // The StdioClientTransport ctor already spawned the child process; a
        // timed-out/failed connect would otherwise leave it running forever.
        // Close the locals (not this.* — which were never assigned on failure)
        // so the orphaned child is reaped.
        try {
          await client?.close();
        } catch {
          /* ignore */
        }
        try {
          await transport?.close();
        } catch {
          /* ignore */
        }
        this.client = null;
        this.transport = null;
        throw err;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private isBrokenPipe(err: unknown): boolean {
    const s = String(err);
    return (
      s.includes("EPIPE") ||
      s.includes("ECONNRESET") ||
      s.includes("closed") ||
      s.includes("not connected") ||
      s.includes("write after end")
    );
  }

  /** Probe by listing tools. Returns false on any error. */
  async available(): Promise<boolean> {
    try {
      await this.ensureConnected();
      if (!this.client) return false;
      await withTimeout(this.client.listTools({}), this.connectTimeoutMs, `listTools ${this.cfg.name}`);
      return true;
    } catch (err) {
      this.log.debug?.({ bridge: this.cfg.name, err: String(err) }, "available() failed");
      return false;
    }
  }

  /**
   * Call a tool. Returns the parsed structuredContent if present, otherwise
   * attempts to JSON.parse the first text content block, otherwise the raw
   * text. Throws on transport errors *after* one reconnect attempt — callers
   * (the bridges) catch and degrade.
   */
  async call<T = unknown>(tool: string, args: unknown): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        await this.ensureConnected();
        if (!this.client) throw new Error("mcp client not connected");
        const result = (await withTimeout(
          this.client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> }),
          10_000,
          `callTool ${tool}`,
        )) as CallToolResultLike;
        if (result.isError) {
          const text = result.content?.[0]?.text ?? "tool returned isError";
          throw new Error(`tool ${tool} error: ${text}`);
        }
        if (result.structuredContent !== undefined) {
          return result.structuredContent as T;
        }
        const text = result.content?.[0]?.text;
        if (typeof text === "string") {
          try {
            return JSON.parse(text) as T;
          } catch {
            return text as unknown as T;
          }
        }
        return undefined as unknown as T;
      } catch (err) {
        if (attempt < 2 && this.isBrokenPipe(err)) {
          this.log.warn(
            { bridge: this.cfg.name, tool, err: String(err) },
            "broken pipe — reconnecting",
          );
          await this.close().catch(() => undefined);
          continue;
        }
        throw err;
      }
    }
  }

  async close(): Promise<void> {
    const singletonKey = this.cfg.singletonKey;
    const pid = this.transport?.pid ?? null;
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    if (singletonKey) {
      releaseSingletonLease(singletonKey, pid);
    }
    this.client = null;
    this.transport = null;
  }
}
