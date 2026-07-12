import type { ArtifactDraft } from "../schemas/artifact.js";

/**
 * Best-of-N stub — the pp-bridge IS implemented.
 *
 * daemon/src/bridges/pp-bridge.ts is an MCP client that reads pp's .mcp.json
 * and connects to the pair-programmer harness.  Two of its capabilities are
 * already exposed as AgentSmith MCP tools in daemon/src/mcp/tools.ts:
 *   - agentsmith.pp.best_of_start  (wraps pp start_best_of_stage)
 *   - agentsmith.pp.borda_count    (wraps pp borda_count)
 *
 * THIS helper remains an unwired stub: it still returns the input draft
 * unchanged and does not call the bridge.  Wiring bestOfN() to the bridge
 * is tracked as future work (AS-GV-6).
 */
export async function bestOfN(draft: ArtifactDraft, _n = 3): Promise<ArtifactDraft> {
  return draft;
}
