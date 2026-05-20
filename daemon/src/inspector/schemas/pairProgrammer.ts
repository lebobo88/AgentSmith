import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { GeneratorSpec, JudgeSpec, ModelId, StringOrList } from "./_common.js";

const Agent = z
  .object({
    name: z.string().min(1),
    model: ModelId,
    description: z.string().min(1),
    tools: StringOrList.optional(),
  })
  .passthrough();

const Skill = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().min(1),
    "allowed-tools": StringOrList.optional(),
  })
  .passthrough();

const Command = z
  .object({
    description: z.string().min(1),
    "argument-hint": z.string().optional(),
    model: ModelId.optional(),
  })
  .passthrough();

const Team = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    profiles_compatible: z.array(z.string()).optional(),
    stages: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            gate_type: z.string().optional(),
            artifact_kind: z.string().optional(),
            generator: GeneratorSpec.optional(),
            judge: JudgeSpec.optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

// PP rubrics ship as Markdown with rich frontmatter (id, bare_id, kind, version, title, source_url).
const Rubric = z
  .object({
    id: z.string().min(1),
    bare_id: z.string().min(1).optional(),
    kind: z.string().min(1),
    version: z.union([z.string(), z.number()]),
    title: z.string().min(1),
    source_url: z.string().optional(),
    generated_by: z.string().optional(),
  })
  .passthrough();

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
  team: Team,
  rubric: Rubric,
};
