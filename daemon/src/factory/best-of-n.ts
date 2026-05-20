import type { ArtifactDraft } from "../schemas/artifact.js";

/**
 * Phase 0 stub. In Phase 1 this delegates to mcp__pp_harness__start_best_of_stage
 * to generate N variants of the requested artifact, then mcp__pp_harness__borda_count
 * to pick a winner. Until pp-bridge lands, we return the input draft unchanged.
 */
export async function bestOfN(draft: ArtifactDraft, _n = 3): Promise<ArtifactDraft> {
  return draft;
}
