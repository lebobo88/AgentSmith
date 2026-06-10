import type { SmithVerdict } from "../schemas/verdict.js";

/**
 * AS-GV-4: Phase 0 stub — policy cross-check is NOT wired to TheEights or Hydra.
 *
 * This function always returns "allow". It does NOT perform a venom cross-check
 * (N2) or a TheEights policy evaluation. Wiring requires injecting the bridge
 * instances into Inspector (a constructor-signature change) and is deferred to
 * Phase 2. Until then, policy enforcement claims in documentation are retracted.
 *
 * Callers MUST NOT rely on this returning "deny" for invariant enforcement.
 * N2 venom gating is done at the MCP boundary in venomCrossCheck (AS-GV-3).
 */
export async function crossCheckPolicy(_subject: {
  kind: string;
  id: string;
  payload: unknown;
}): Promise<SmithVerdict> {
  return {
    outcome: "allow",
    rationale: "policy cross-check not yet implemented (Phase 2 pending — AS-GV-4)",
    cited_invariants: [],
    evidence: [{ key: "phase", value: "0-stub" }],
    decided_at: new Date().toISOString(),
  };
}
