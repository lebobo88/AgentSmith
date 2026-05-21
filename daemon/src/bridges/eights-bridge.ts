/**
 * EightsBridge — real MCP client to TheEights' daemon.
 *
 * Spawns `node <TheEights>/daemon/dist/index.js` as a child process and calls
 * its `eights.*` MCP tools. Every method is degraded-by-default: if the bridge
 * isn't reachable, callers get a marker object back instead of an exception.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpClient, type BridgeLogger, type McpServerConfig } from "./mcp-client.js";

export interface EightsBridgeOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  logger?: BridgeLogger;
  /** Override the on-disk spool dir. Defaults to ~/.agentsmith/eights-pending. */
  spoolDir?: string;
}

const DEFAULT_EIGHTS_ENTRY = "C:/AiAppDeployments/TheEights/daemon/dist/index.js";

/**
 * Payload shape persisted to disk in the eights-pending spool.
 *
 * `args` is the original `evolutionPropose` input so replay can re-issue the
 * exact same MCP call. `spooled_at` is set by the bridge on failure.
 */
interface SpooledProposal {
  id: string;
  tool: "eights.evolution.propose";
  args: {
    rid: string;
    candidate_content: string;
    justification: string;
    evidence_memory_ids?: string[];
  };
  spooled_at: string;
  reason: string;
}

/** Summary returned by replayPendingProposals(). */
export interface ReplaySummary {
  sent: number;
  failed: number;
  skipped: number;
}

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
  private readonly spoolDir: string;

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
    this.spoolDir = opts.spoolDir ?? join(homedir(), ".agentsmith", "eights-pending");
  }

  /**
   * Persist a failed eights.evolution.propose payload to the on-disk spool.
   * Atomic write: stage to `<uuid>.json.partial` then rename to `<uuid>.json`.
   * Fail-soft: any write error is logged and swallowed (the in-memory
   * degraded marker is still returned to the caller).
   */
  private spoolProposal(
    args: SpooledProposal["args"],
    reason: string,
  ): { spooled: true; id: string } | { spooled: false } {
    try {
      mkdirSync(this.spoolDir, { recursive: true });
      const id = randomUUID();
      const payload: SpooledProposal = {
        id,
        tool: "eights.evolution.propose",
        args,
        spooled_at: new Date().toISOString(),
        reason,
      };
      const finalPath = join(this.spoolDir, `${id}.json`);
      const partialPath = `${finalPath}.partial`;
      writeFileSync(partialPath, JSON.stringify(payload, null, 2), "utf8");
      renameSync(partialPath, finalPath);
      this.log.warn(
        { spoolDir: this.spoolDir, id, reason },
        "spooled failed eights.evolution.propose for replay",
      );
      return { spooled: true, id };
    } catch (err) {
      this.log.error(
        { err: String(err), spoolDir: this.spoolDir },
        "failed to spool eights proposal — proposal will be lost",
      );
      return { spooled: false };
    }
  }

  /**
   * Drain the on-disk spool by re-issuing each pending proposal directly to
   * the MCP child-process boundary (`this.client.call`). Successful sends
   * delete the file; failures leave it for the next replay attempt; corrupt
   * files don't block draining the rest (they are counted as `skipped`).
   *
   * Returns a {sent, failed, skipped} summary. Never throws.
   */
  async replayPendingProposals(): Promise<ReplaySummary> {
    const summary: ReplaySummary = { sent: 0, failed: 0, skipped: 0 };
    let entries: string[];
    try {
      if (!existsSync(this.spoolDir)) return summary;
      entries = readdirSync(this.spoolDir).filter((f) => f.endsWith(".json"));
    } catch (err) {
      this.log.warn({ err: String(err), spoolDir: this.spoolDir }, "replay: readdir failed");
      return summary;
    }

    for (const fname of entries) {
      const fpath = join(this.spoolDir, fname);
      let parsed: SpooledProposal;
      try {
        const raw = readFileSync(fpath, "utf8");
        parsed = JSON.parse(raw) as SpooledProposal;
      } catch (err) {
        this.log.warn(
          { err: String(err), file: fpath },
          "replay: corrupt/unreadable spool file — skipping (left in place)",
        );
        summary.skipped += 1;
        continue;
      }
      // Sanity: only replay propose payloads we recognise.
      if (parsed.tool !== "eights.evolution.propose" || !parsed.args || !parsed.args.rid) {
        this.log.warn({ file: fpath }, "replay: unknown payload shape — skipping");
        summary.skipped += 1;
        continue;
      }
      try {
        await this.client.call<{ proposal_id?: string; auto_committed?: boolean }>(
          "eights.evolution.propose",
          parsed.args,
        );
        try {
          unlinkSync(fpath);
        } catch (unlinkErr) {
          this.log.warn(
            { err: String(unlinkErr), file: fpath },
            "replay: send succeeded but unlink failed — may double-send on next replay",
          );
        }
        summary.sent += 1;
      } catch (err) {
        this.log.warn(
          { err: String(err), file: fpath },
          "replay: re-send failed — leaving for next attempt",
        );
        summary.failed += 1;
      }
    }
    return summary;
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
    | (DegradedMarker & { proposal_id: string; auto_committed: boolean; spooled_id?: string })
  > {
    // Drain any prior degraded proposals first (fail-soft — never blocks the
    // new propose). The next successful propose effectively flushes the spool.
    try {
      const summary = await this.replayPendingProposals();
      if (summary.sent > 0 || summary.failed > 0 || summary.skipped > 0) {
        this.log.warn(
          {
            sent: summary.sent,
            failed: summary.failed,
            skipped: summary.skipped,
          },
          "eights spool replay summary",
        );
      }
    } catch (err) {
      this.log.warn({ err: String(err) }, "spool replay threw — proceeding with new propose");
    }

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
      const spoolResult = this.spoolProposal(input, "eights-mcp-unavailable");
      const base = degraded(
        { proposal_id: "degraded", auto_committed: false },
        "eights-mcp-unavailable",
      );
      return spoolResult.spooled ? { ...base, spooled_id: spoolResult.id } : base;
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
