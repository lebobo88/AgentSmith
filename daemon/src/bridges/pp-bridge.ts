/**
 * PpBridge — MCP client to the pair-programmer harness daemon.
 *
 * Default command is read from <pp-root>/.mcp.json (the `pp_harness` entry).
 * If the file isn't present, falls back to
 *   node C:/AiAppDeployments/pair-programmer/daemon/dist/index.js mcp
 *
 * The pp_harness MCP server exposes tools with bare names (no namespace),
 * e.g. `start_best_of_stage`, `borda_count`, `archive_winner_and_losers`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { McpClient, type BridgeLogger, type McpServerConfig } from "./mcp-client.js";

const DEFAULT_PP_ROOT = "C:/AiAppDeployments/pair-programmer";
const PP_MCP_JSON = `${DEFAULT_PP_ROOT}/.mcp.json`;
const FALLBACK_ENTRY = `${DEFAULT_PP_ROOT}/daemon/dist/index.js`;

export interface PpBridgeOptions {
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

interface McpJsonEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpJson {
  mcpServers?: Record<string, McpJsonEntry>;
}

function readPpHarnessEntry(): { command: string; args: string[]; env?: Record<string, string> } | null {
  if (!existsSync(PP_MCP_JSON)) return null;
  try {
    const text = readFileSync(PP_MCP_JSON, "utf8");
    const j = JSON.parse(text) as McpJson;
    const entry = j.mcpServers?.["pp_harness"];
    if (!entry?.command || !entry.args) return null;
    // .mcp.json args are relative to project root; resolve them.
    const resolvedArgs = entry.args.map((a) =>
      a.endsWith(".js") && !isAbsolute(a) ? resolve(DEFAULT_PP_ROOT, a) : a,
    );
    return entry.env
      ? { command: entry.command, args: resolvedArgs, env: entry.env }
      : { command: entry.command, args: resolvedArgs };
  } catch {
    return null;
  }
}

export class PpBridge {
  private readonly client: McpClient;
  private readonly log: BridgeLogger;

  constructor(opts: PpBridgeOptions = {}) {
    const fromJson = readPpHarnessEntry();
    const command = opts.command ?? fromJson?.command ?? "node";
    const args = opts.args ?? fromJson?.args ?? [FALLBACK_ENTRY, "mcp"];
    const env = opts.env ?? fromJson?.env;
    const cfg: McpServerConfig = {
      name: "pp",
      command,
      args,
      ...(opts.cwd ? { cwd: opts.cwd } : existsSync(DEFAULT_PP_ROOT) ? { cwd: DEFAULT_PP_ROOT } : {}),
      ...(env ? { env } : {}),
    };
    this.log =
      opts.logger ??
      ({
        warn: (o, m) => console.error("[pp-bridge] WARN", m ?? "", JSON.stringify(o)),
        error: (o, m) => console.error("[pp-bridge] ERROR", m ?? "", JSON.stringify(o)),
      } satisfies BridgeLogger);
    this.client = new McpClient(cfg, this.log);
  }

  available(): Promise<boolean> {
    return this.client.available();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async startBestOfStage(input: {
    run_id: string;
    stage_id: string;
    prompt: string;
    n: number;
  }): Promise<
    | { candidates: Array<{ candidate_id: string; content: string }> }
    | (DegradedMarker & { candidates: Array<{ candidate_id: string; content: string }> })
  > {
    try {
      const r = await this.client.call<{
        candidates?: Array<{ candidate_id?: string; content?: string }>;
      }>("start_best_of_stage", input);
      const candidates = (r.candidates ?? []).map((c) => ({
        candidate_id: c.candidate_id ?? "",
        content: c.content ?? "",
      }));
      return { candidates };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "start_best_of_stage" }, "degraded");
      return degraded({ candidates: [] }, "pp-mcp-unavailable");
    }
  }

  async bordaCount(
    candidate_ids: string[],
    rubric_ids: string[],
  ): Promise<
    | { winner_id: string; scores: Record<string, number> }
    | (DegradedMarker & { winner_id: string; scores: Record<string, number> })
  > {
    try {
      const r = await this.client.call<{
        winner_id?: string;
        scores?: Record<string, number>;
      }>("borda_count", { candidate_ids, rubric_ids });
      return { winner_id: r.winner_id ?? "", scores: r.scores ?? {} };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "borda_count" }, "degraded");
      return degraded({ winner_id: "", scores: {} as Record<string, number> }, "pp-mcp-unavailable");
    }
  }

  async archiveWinnerAndLosers(input: {
    run_id: string;
    stage_id: string;
    winner_id: string;
    loser_ids?: string[];
  }): Promise<{ archived: boolean } | (DegradedMarker & { archived: boolean })> {
    try {
      const r = await this.client.call<{ archived?: boolean; ok?: boolean }>(
        "archive_winner_and_losers",
        input,
      );
      return { archived: Boolean(r.archived ?? r.ok ?? true) };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "archive_winner_and_losers" }, "degraded");
      return degraded({ archived: false }, "pp-mcp-unavailable");
    }
  }

  async recordVerdict(input: {
    run_id: string;
    stage_id: string;
    candidate_id: string;
    verdict: string;
    rationale?: string;
  }): Promise<{ ok: boolean } | (DegradedMarker & { ok: boolean })> {
    try {
      const r = await this.client.call<{ ok?: boolean }>("record_verdict", input);
      return { ok: Boolean(r.ok ?? true) };
    } catch (err) {
      this.log.warn({ err: String(err), tool: "record_verdict" }, "degraded");
      return degraded({ ok: false }, "pp-mcp-unavailable");
    }
  }

  async getRubric(rubric_id: string): Promise<unknown | (DegradedMarker & { rubric: null })> {
    try {
      return await this.client.call<unknown>("get_rubric", { rubric_id });
    } catch (err) {
      this.log.warn({ err: String(err), tool: "get_rubric", rubric_id }, "degraded");
      return degraded({ rubric: null }, "pp-mcp-unavailable");
    }
  }
}
