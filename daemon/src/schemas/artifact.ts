import { z } from "zod";

export const ARTIFACT_KINDS = [
  "agent",
  "skill",
  "command",
  "hook",
  "team",
  "squad",
  "rubric",
  "mcp",
] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ConsumerProjectSchema = z.enum([
  "hydra",
  "eights",
  "executiveSuite",
  "marketBliss",
  "rlmCreative",
  "pairProgrammer",
  "agentSmith",
]);
export type ConsumerProject = z.infer<typeof ConsumerProjectSchema>;

export const ArtifactDraftSchema = z.object({
  draft_id: z.string(),
  kind: ArtifactKindSchema,
  slug: z.string().regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, "slug must be kebab-case"),
  project: ConsumerProjectSchema,
  target_path: z.string(),
  content: z.string(),
  frontmatter: z.record(z.unknown()).optional(),
  template_id: z.string().optional(),
  generator_seed: z.string().optional(),
  created_at: z.string().datetime(),
});
export type ArtifactDraft = z.infer<typeof ArtifactDraftSchema>;

export const ArtifactTemplateSchema = z.object({
  template_id: z.string(),
  kind: ArtifactKindSchema,
  project: ConsumerProjectSchema,
  description: z.string(),
  body: z.string(),
  required_frontmatter_keys: z.array(z.string()),
  evolution_risk_class: z.enum(["low", "medium", "high", "critical"]),
});
export type ArtifactTemplate = z.infer<typeof ArtifactTemplateSchema>;
