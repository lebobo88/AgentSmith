/**
 * HydraBridge — MCP client to Hydra.
 *
 * Hydra's MCP servers are Python (`python -m mcp_servers.<server>`). The closest
 * thing to a "central" server is `executive_suite`; per-domain Venom / squad /
 * envelope tools may not exist yet, so every method here degrades politely on
 * a missing tool or transport error.
 *
 * Default command: `python -m mcp_servers.executive_suite` with cwd=<Hydra root>.
 */
import { existsSync } from "node:fs";
import { McpClient, type BridgeLogger, type McpServerConfig } from "./mcp-client.js";

const DEFAULT_HYDRA_ROOT = "C:/AiAppDeployments/Hydra";

export interface HydraBridgeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  logger?: BridgeLogger;
}

export interface DegradedMarker {
  degraded: true;
  reason: string;
}

function degraded<T extends Record<string, unknown>>(extra: T, reason: string): T & DegradedMarker {
  return { ...extra, degraded: true, reason };
}

export class HydraBridge {
  private readonly client: McpClient;
  private readonly log: BridgeLogger;

  constructor(opts: HydraBridgeOptions = {}) {
    const cwd = opts.cwd ?? (existsSync(DEFAULT_HYDRA_ROOT) ? DEFAULT_HYDRA_ROOT : process.cwd());
    const cfg: McpServerConfig = {
      name: "hydra",
      command: opts.command ?? "python",
      args: opts.args ?? ["-m", "mcp_servers.executive_suite"],
      cwd,
      ...(opts.env ? { env: opts.env } : {}),
    };
    this.log =
      opts.logger ??
      ({
        warn: (o, m) => console.error("[hydra-bridge] WARN", m ?? "", JSON.stringify(o)),
        error: (o, m) => console.error("[hydra-bridge] ERROR", m ?? "", JSON.stringify(o)),
      } satisfies BridgeLogger);
    this.client = new McpClient(cfg, this.log);
  }

  available(): Promise<boolean> {
    return this.client.available();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async venomCrossCheck(
    capability: string,
    args: unknown,
  ): Promise<{ ok: boolean; rationale: string } | (DegradedMarker & { ok: boolean; rationale: string })> {
    try {
      const r = await this.client.call<{ ok?: boolean; rationale?: string }>(
        "hydra.venom.cross_check",
        { capability, args },
      );
      return { ok: Boolean(r.ok), rationale: r.rationale ?? "" };
    } catch (err) {
      this.log.warn({ err: String(err), capability }, "venomCrossCheck degraded");
      return degraded(
        { ok: true, rationale: "venom unreachable — failing open per N-default" },
        "hydra-mcp-unavailable",
      );
    }
  }

  /**
   * Polling telemetry tail. Hydra writes `.hydra/<wf>/trace.jsonl` directly;
   * a future MCP tool may stream it. For now we attempt a polling call and
   * close silently if the tool is missing.
   */
  telemetryTail(
    workflow_id: string,
    intervalMs = 1500,
  ): AsyncIterable<{ kind: string; payload: unknown }> {
    const client = this.client;
    const log = this.log;
    return (async function* () {
      let cursor: string | undefined;
      while (true) {
        try {
          const args: Record<string, unknown> = { workflow_id };
          if (cursor) args["since"] = cursor;
          const r = await client.call<{
            events?: Array<{ kind?: string; payload?: unknown; cursor?: string }>;
          }>("hydra.telemetry.tail", args);
          const events = r.events ?? [];
          for (const ev of events) {
            yield { kind: ev.kind ?? "event", payload: ev.payload ?? null };
            if (ev.cursor) cursor = ev.cursor;
          }
        } catch (err) {
          log.debug?.({ err: String(err), workflow_id }, "telemetryTail degraded — stopping");
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    })();
  }

  async squadRegistry(): Promise<
    Array<{ name: string; version: string; entrypoint: string }>
  > {
    try {
      const r = await this.client.call<{
        squads?: Array<{ name?: string; version?: string; entrypoint?: string }>;
      }>("hydra.squad.list", {});
      return (r.squads ?? []).map((s) => ({
        name: s.name ?? "",
        version: s.version ?? "0.0.0",
        entrypoint: s.entrypoint ?? "",
      }));
    } catch (err) {
      this.log.warn({ err: String(err) }, "squadRegistry degraded");
      return [];
    }
  }

  async envelopeRecord(envelope: {
    kind: string;
    from_squad: string;
    to_squad?: string;
    workflow_id: string;
    payload: unknown;
  }): Promise<{ envelope_id: string } | (DegradedMarker & { envelope_id: string })> {
    try {
      const r = await this.client.call<{ envelope_id?: string }>(
        "hydra.envelope.record",
        envelope,
      );
      return { envelope_id: r.envelope_id ?? "unknown" };
    } catch (err) {
      this.log.warn({ err: String(err), kind: envelope.kind }, "envelopeRecord degraded");
      return degraded({ envelope_id: "degraded" }, "hydra-mcp-unavailable");
    }
  }
}
