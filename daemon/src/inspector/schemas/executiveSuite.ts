import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { ModelId, StringOrList } from "./_common.js";

// ExecutiveSuite agents: name + description + model required; skills + maxTurns common.
const Agent = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    model: ModelId,
    maxTurns: z.number().int().positive().optional(),
    skills: z.array(z.string()).optional(),
    tools: StringOrList.optional(),
    color: z.string().optional(),
  })
  .passthrough();

const Skill = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    "allowed-tools": StringOrList.optional(),
    "user-invocable": z.boolean().optional(),
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

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
};
