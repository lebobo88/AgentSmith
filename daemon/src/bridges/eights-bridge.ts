/**
 * EightsBridge — real MCP client to TheEights' daemon.
 *
 * Spawns `node <TheEights>/daemon/dist/index.js` as a child process and calls
 * its `eights.*` MCP tools. Every method is degraded-by-default: if the bridge
 * isn't reachable, callers get a marker object back instead of an exception.
 */
import { existsSync } from "node:fs";
import { McpClient, type BridgeLogger, type McpServerConfig } from "./mcp-client.js";

export interface EightsBridgeOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  logger?: BridgeLogger;
}

const DEFAULT_EIGHTS_ENTRY = "C:/AiAppDeployments/TheEights/daemon/dist/index.js";

export interface DegradedMarker {
  degraded: true;
  reason: string;
}

function degraded<T extends Record<string, unknown>>(extra: T, reason: string): T & DegradedMarker {
  return { ...extra, degraded: true, reason };
}

export class EightsBridge {
  private readonly client: McpClient;
  private readonly log: BridgeLogger;

  constructor(opts: EightsBridgeOptions = {}) {
    const command = opts.command ?? "node";
    const args =
      opts.args ??
      (existsSync(DEFAULT_EIGHTS_ENTRY) ? [DEFAULT_EIGHTS_ENTRY] : [DEFAULT_EIGHTS_ENTRY]);
    const cfg: McpServerConfig = {
      name: "eights",
      command,
      args,
      ...(opts.env ? { env: opts.env } : {}),
    };
    this.log =
      opts.logger ??
      ({
        warn: (o, m) => console.error("[eights-bridge] WARN", m ?? "", JSON.stringify(o)),
        error: (o, m) => console.error("[eights-bridge] ERROR", m ?? "", JSON.stringify(o)),
      } satisfies BridgeLogger);
    this.client = new McpClient(cfg, this.log);
  }

  available(): Promise<boolean> {
    return this.client.available();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async memoryAdd(payload: {
    type: string;
    content: string;
    cell?: string;
    scopes?: string[];
  }): Promise<{ id: string } | (DegradedMarker & { id: string })> {
    try {
      const r = await this.client.call<{ id?: string }>("eights.memory.add", payload);
      return { id: r.id ?? "unknown" };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.memory.add" }, "degraded");
      return degraded({ id: "degraded" }, "eights-mcp-unavailable");
    }
  }

  async memorySearch(input: {
    query: string;
    type?: string;
    cell?: string;
    limit?: number;
  }): Promise<{ results: unknown[] } | (DegradedMarker & { results: unknown[] })> {
    try {
      const r = await this.client.call<{ results?: unknown[] }>("eights.memory.search", input);
      return { results: r.results ?? [] };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.memory.search" }, "degraded");
      return degraded({ results: [] as unknown[] }, "eights-mcp-unavailable");
    }
  }

  async evolutionPropose(input: {
    rid: string;
    candidate_content: string;
    justification: string;
    evidence_memory_ids?: string[];
  }): Promise<
    | { proposal_id: string; auto_committed: boolean }
    | (DegradedMarker & { proposal_id: string; auto_committed: boolean })
  > {
    try {
      const r = await this.client.call<{ proposal_id?: string; auto_committed?: boolean }>(
        "eights.evolution.propose",
        input,
      );
      return {
        proposal_id: r.proposal_id ?? "unknown",
        auto_committed: Boolean(r.auto_committed),
      };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.evolution.propose" }, "degraded");
      return degraded(
        { proposal_id: "degraded", auto_committed: false },
        "eights-mcp-unavailable",
      );
    }
  }

  async evolutionCommit(input: {
    proposal_id: string;
    approver?: string;
  }): Promise<{ committed: boolean } | (DegradedMarker & { committed: boolean })> {
    try {
      const r = await this.client.call<{ committed?: boolean }>("eights.evolution.commit", input);
      return { committed: Boolean(r.committed) };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.evolution.commit" }, "degraded");
      return degraded({ committed: false }, "eights-mcp-unavailable");
    }
  }

  async governanceHitlRequest(input: {
    reason: string;
    payload: unknown;
  }): Promise<{ request_id: string } | (DegradedMarker & { request_id: string })> {
    try {
      const r = await this.client.call<{ request_id?: string }>(
        "eights.governance.hitl.request",
        input,
      );
      return { request_id: r.request_id ?? "unknown" };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.governance.hitl.request" }, "degraded");
      return degraded({ request_id: "degraded" }, "eights-mcp-unavailable");
    }
  }

  async governanceHitlList(input: {
    status?: string;
    limit?: number;
  } = {}): Promise<{ requests: unknown[] } | (DegradedMarker & { requests: unknown[] })> {
    try {
      const r = await this.client.call<{ requests?: unknown[] }>(
        "eights.governance.hitl.list",
        input,
      );
      return { requests: r.requests ?? [] };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.governance.hitl.list" }, "degraded");
      return degraded({ requests: [] as unknown[] }, "eights-mcp-unavailable");
    }
  }

  async constitutionAttest(
    workflow_id: string,
  ): Promise<
    | { receipt_id: string; hash: string }
    | (DegradedMarker & { receipt_id: string; hash: string })
  > {
    try {
      const r = await this.client.call<{ receipt_id?: string; hash?: string }>(
        "eights.constitution.attest",
        { workflow_id },
      );
      return {
        receipt_id: r.receipt_id ?? "unknown",
        hash: r.hash ?? "0".repeat(64),
      };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.constitution.attest" }, "degraded");
      return degraded(
        { receipt_id: "degraded", hash: "0".repeat(64) },
        "eights-mcp-unavailable",
      );
    }
  }

  async auditTrace(input: {
    trace_id?: string;
    scope?: string;
    since?: string;
    limit?: number;
  }): Promise<
    | { events: Array<{ ts?: string; kind: string; payload: unknown }> }
    | (DegradedMarker & { events: Array<{ ts?: string; kind: string; payload: unknown }> })
  > {
    try {
      const r = await this.client.call<{
        events?: Array<{ ts?: string; kind?: string; payload?: unknown }>;
      }>("eights.audit.trace", input);
      const events = (r.events ?? []).map((e) => ({
        ts: e.ts,
        kind: e.kind ?? "event",
        payload: e.payload ?? null,
      }));
      return { events };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "eights.audit.trace" }, "degraded");
      return degraded(
        { events: [] as Array<{ ts?: string; kind: string; payload: unknown }> },
        "eights-mcp-unavailable",
      );
    }
  }

  /**
   * Polling tail. TheEights does not (yet) expose a streaming `observability.tail`
   * MCP tool, so we approximate one by repeatedly calling `eights.audit.trace`
   * (cheap, idempotent) and yielding new events. Closes silently on any error.
   */
  observabilityTail(
    scope: string,
    intervalMs = 1000,
  ): AsyncIterable<{ kind: string; payload: unknown }> {
    const client = this.client;
    const log = this.log;
    return (async function* () {
      let lastCursor: string | undefined;
      while (true) {
        try {
          const args: Record<string, unknown> = { scope };
          if (lastCursor) args["since"] = lastCursor;
          const r = await client.call<{
            events?: Array<{ kind?: string; payload?: unknown; cursor?: string }>;
          }>("eights.audit.trace", args);
          const events = r.events ?? [];
          for (const ev of events) {
            yield { kind: ev.kind ?? "event", payload: ev.payload ?? null };
            if (ev.cursor) lastCursor = ev.cursor;
          }
        } catch (err) {
          log.debug?.({ err: String(err), scope }, "observabilityTail degraded — stopping");
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    })();
  }
}
