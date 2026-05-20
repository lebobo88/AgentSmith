import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { ModelId, StringOrList } from "./_common.js";

const Agent = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    model: ModelId,
    tools: StringOrList.optional(),
    disallowedTools: StringOrList.optional(),
    maxTurns: z.number().int().positive().optional(),
    context: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  })
  .passthrough();

const Skill = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    "allowed-tools": StringOrList.optional(),
  })
  .passthrough();

const Command = z
  .object({
    description: z.string().min(1),
    "argument-hint": z.string().optional(),
    model: ModelId.optional(),
    context: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  })
  .passthrough();

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
};
