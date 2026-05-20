import { z } from "zod";

export const SmithVerdictOutcomeSchema = z.enum(["allow", "deny", "modify", "escalate"]);
export type SmithVerdictOutcome = z.infer<typeof SmithVerdictOutcomeSchema>;

export const SmithVerdictSchema = z.object({
  outcome: SmithVerdictOutcomeSchema,
  rationale: z.string(),
  cited_invariants: z.array(z.string()).default([]),
  suggested_fix: z.string().optional(),
  escalation_target: z.string().optional(),
  evidence: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  decided_at: z.string().datetime(),
});
export type SmithVerdict = z.infer<typeof SmithVerdictSchema>;
