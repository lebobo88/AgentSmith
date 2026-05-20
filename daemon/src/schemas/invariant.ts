import { z } from "zod";

export const SmithInvariantSchema = z.object({
  id: z.string().regex(/^N\d{1,3}$/, "invariant id must match /^N\\d+$/"),
  name: z.string().min(1),
  rationale: z.string().min(1),
  enforcement: z.enum(["fail_closed", "fail_open_with_audit", "warn_only"]),
  authority: z.enum(["external_governance", "constitution", "operator_override"]),
  amendable: z.boolean(),
  references: z.array(z.string()).default([]),
});

export type SmithInvariant = z.infer<typeof SmithInvariantSchema>;

export const SmithConstitutionSnapshotSchema = z.object({
  text: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  invariants: z.array(SmithInvariantSchema),
  loaded_at: z.string().datetime(),
});

export type SmithConstitutionSnapshot = z.infer<typeof SmithConstitutionSnapshotSchema>;
