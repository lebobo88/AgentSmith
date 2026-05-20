import { z } from "zod";
import type { ArtifactKind } from "../../schemas/artifact.js";
import { ModelId, StringOrList } from "./_common.js";

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

// Hydra squad.yaml — pure YAML (no fence). Required: name, version, entrypoint, accepts, emits.
const SquadAgent = z
  .object({
    slug: z.string().min(1),
    role: z.string().optional(),
    authority: z.string().optional(),
  })
  .passthrough();

const SquadGate = z
  .object({
    rubric_id: z.string().min(1),
    hitl_required: z.boolean().optional(),
    when: z.string().optional(),
  })
  .passthrough();

const Squad = z
  .object({
    name: z.string().min(1),
    version: z.union([z.string(), z.number()]),
    deprecated_after: z.union([z.string(), z.null()]).optional(),
    description: z.string().min(1),
    source_pack: z.string().optional(),
    entrypoint: z.string().min(1),
    best_of_n: z.number().int().positive().optional(),
    industries: z.array(z.string()).optional(),
    agents: z.array(SquadAgent).min(1),
    accepts: z.array(z.string()).min(1),
    emits: z.array(z.string()).min(1),
    gates: z.array(SquadGate).optional(),
    tools: z.array(z.record(z.unknown())).optional(),
    invoke: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const SCHEMAS: Partial<Record<ArtifactKind, z.ZodTypeAny>> = {
  agent: Agent,
  skill: Skill,
  command: Command,
  squad: Squad,
};
