import type { z } from "zod";
import type { ArtifactKind, ConsumerProject } from "../../schemas/artifact.js";
import { SCHEMAS as hydra } from "./hydra.js";
import { SCHEMAS as eights } from "./eights.js";
import { SCHEMAS as executiveSuite } from "./executiveSuite.js";
import { SCHEMAS as marketBliss } from "./marketBliss.js";
import { SCHEMAS as rlmCreative } from "./rlmCreative.js";
import { SCHEMAS as pairProgrammer } from "./pairProgrammer.js";
import { SCHEMAS as agentSmith } from "./agentSmith.js";

export const PROJECT_SCHEMAS: Record<ConsumerProject, Partial<Record<ArtifactKind, z.ZodTypeAny>>> = {
  hydra,
  eights,
  executiveSuite,
  marketBliss,
  rlmCreative,
  pairProgrammer,
  agentSmith,
};
