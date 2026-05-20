import { z } from "zod";

export const ReplicationQuotaSchema = z.object({
  scope: z.string(),
  max_clones: z.number().int().positive(),
  active: z.number().int().nonnegative(),
  reason_last_spawn: z.string().optional(),
  last_changed_at: z.string().datetime(),
});
export type ReplicationQuota = z.infer<typeof ReplicationQuotaSchema>;

export const SmithCloneSchema = z.object({
  clone_id: z.string(),
  parent_scope: z.string(),
  spawned_for: z.string(),
  spawned_at: z.string().datetime(),
  torn_down_at: z.string().datetime().optional(),
  active: z.boolean(),
});
export type SmithClone = z.infer<typeof SmithCloneSchema>;
