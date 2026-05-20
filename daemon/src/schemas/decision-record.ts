import { z } from "zod";
import { SmithVerdictSchema } from "./verdict.js";

export const SmithDecisionRecordSchema = z.object({
  decision_id: z.string(),
  workflow_id: z.string().optional(),
  trace_id: z.string().optional(),
  actor: z.string(),
  subject: z.object({
    kind: z.string(),
    id: z.string(),
  }),
  verdict: SmithVerdictSchema,
  parent_decision_id: z.string().optional(),
  audit_links: z.array(z.string()).default([]),
  sealed: z.literal(true),
  sealed_at: z.string().datetime(),
});
export type SmithDecisionRecord = z.infer<typeof SmithDecisionRecordSchema>;
