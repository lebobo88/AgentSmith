import { z } from "zod";
import { ArtifactKindSchema, ConsumerProjectSchema } from "./artifact.js";

/**
 * MetaProposal — Hydra envelope subclass emitted by AgentSmith when proposing
 * a change to the agentic layer itself (new agent, new rubric, evolved skill).
 * Routed to the agentsmith-meta squad for governance review before promotion
 * via TheEights evolution.propose.
 */
export const MetaProposalSchema = z.object({
  id: z.string(),
  type: z.literal("META_PROPOSAL"),
  origin_squad: z.string(),
  target_squad: z.string().optional(),
  workflow_id: z.string(),
  parent_id: z.string().optional(),
  created_at: z.string().datetime(),
  proposal: z.object({
    artifact_kind: ArtifactKindSchema,
    target_project: ConsumerProjectSchema,
    draft_id: z.string(),
    rationale: z.string(),
    evidence_memory_ids: z.array(z.string()).default([]),
    risk_class: z.enum(["low", "medium", "high", "critical"]),
    requested_evolution_policy: z.enum(["auto", "auto-low-risk", "hitl-only", "frozen"]),
  }),
});
export type MetaProposal = z.infer<typeof MetaProposalSchema>;
