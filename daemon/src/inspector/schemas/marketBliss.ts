import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { GeneratorSpec, JudgeSpec, ModelId, StringOrList } from "./_common.js";

const Agent = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    model: ModelId,
    maxTurns: z.number().int().positive().optional(),
    skills: z.array(z.string()).optional(),
    tools: StringOrList.optional(),
  })
  .passthrough();

const Skill = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    "user-invocable": z.boolean().optional(),
    "allowed-tools": StringOrList.optional(),
  })
  .passthrough();

const Command = z
  .object({
    description: z.string().min(1),
    "argument-hint": z.string().optional(),
    model: ModelId.optional(),
    skills: z.array(z.string()).optional(),
  })
  .passthrough();

// MarketBliss teams are YAML documents (no frontmatter fence); the validator strips that case.
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
            generator: GeneratorSpec.optional(),
            judge: JudgeSpec.optional(),
            artifact_kind: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
    taxonomy_required: z.array(z.string()).optional(),
    missability_required: z.array(z.string()).optional(),
  })
  .passthrough();

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
  team: Team,
};
