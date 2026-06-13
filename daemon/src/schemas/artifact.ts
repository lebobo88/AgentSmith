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
  "adr",
] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/**
 * Known camelCase project slugs that resolve to legacy `cfg.consumerRoots`
 * entries. Kept as a literal list for back-compat (callers/types depending on
 * these names still work) but the schema below is widened to accept any
 * kebab-case slug so brand-new consumer projects can be scaffolded without
 * an enum edit.
 */
export const KNOWN_CONSUMER_PROJECTS = [
  "hydra",
  "eights",
  "executiveSuite",
  "marketBliss",
  "rlmCreative",
  "pairProgrammer",
  "agentSmith",
] as const;
export type KnownConsumerProject = (typeof KNOWN_CONSUMER_PROJECTS)[number];

/**
 * ConsumerProjectSchema accepts:
 *   - The legacy camelCase names in KNOWN_CONSUMER_PROJECTS (back-compat).
 *   - Any kebab-case slug starting with a letter (e.g. "rlm-platform",
 *     "consumer-project-x"). The factory resolves these to
 *     `<AIAPP_BASE>/<slug>` if no explicit `consumerRoots[<slug>]`
 *     is configured.
 *
 * The regex blocks injection / path-traversal nonsense (no slashes, dots,
 * backslashes, or uppercase letters).
 */
export const ConsumerProjectSchema = z
  .string()
  .min(1)
  .regex(
    /^([a-z][a-z0-9-]+|[a-z][a-zA-Z0-9]*)$/,
    "project slug must be kebab-case starting with a letter, OR a known camelCase project name",
  );
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
