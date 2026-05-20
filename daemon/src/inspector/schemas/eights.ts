import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { ModelId, StringOrList } from "./_common.js";

// TheEights does not currently ship a .claude/ tree; schemas mirror the cross-project
// minimal conventions so an artifact authored under the eights project is still validated.
const Agent = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    model: ModelId,
    skills: z.array(z.string()).optional(),
    tools: StringOrList.optional(),
  })
  .passthrough();

const Skill = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .passthrough();

const Command = z
  .object({
    description: z.string().min(1),
    model: ModelId.optional(),
  })
  .passthrough();

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
};
