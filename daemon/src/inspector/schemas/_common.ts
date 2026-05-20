import { z } from "zod";

/** A YAML list-or-string-or-CSV (claude tools: "a, b, c" OR ["a","b"]). */
export const StringOrList = z.union([z.string(), z.array(z.string())]);

/** Permissive model identifier — accepts "opus" | "sonnet" | "haiku" | full IDs. */
export const ModelId = z.string().min(1);

/** Slug — kebab-case identifier. */
export const Slug = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/, "must be kebab-case");

/** Cross-vendor judge spec used by team yamls. */
export const JudgeSpec = z
  .object({
    tier: z.string().optional(),
    rubric: z.string().optional(),
    model_pref: z.string().optional(),
  })
  .passthrough();

export const GeneratorSpec = z
  .object({
    agent: z.string(),
    primary: z.string().optional(),
  })
  .passthrough();
