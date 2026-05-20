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
    this.connectTimeoutMs = cfg.connectTimeoutMs ?? 2000;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        const transportEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (typeof v === "string") transportEnv[k] = v;
        }
        if (this.cfg.env) {
          for (const [k, v] of Object.entries(this.cfg.env)) transportEnv[k] = v;
        }
        const transport = new StdioClientTransport({
          command: this.cfg.command,
          args: this.cfg.args,
          env: transportEnv,
          ...(this.cfg.cwd ? { cwd: this.cfg.cwd } : {}),
        });
        const client = new Client(
          { name: `agentsmith-bridge:${this.cfg.name}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await withTimeout(
          client.connect(transport),
          this.connectTimeoutMs,
          `connect ${this.cfg.name}`,
        );
        this.transport = transport;
        this.client = client;
      } catch (err) {
        this.log.warn(
          { bridge: this.cfg.name, err: String(err) },
          "mcp-client connect failed",
        );
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
    this.client = null;
    this.transport = null;
  }
}
