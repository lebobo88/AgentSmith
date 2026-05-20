import type { ConsumerProject, ArtifactKind } from "../../schemas/artifact.js";
import type { ProjectTemplates, TemplateRegistry, TemplateFn } from "./types.js";

import { HYDRA } from "./hydra/index.js";
import { EIGHTS } from "./eights/index.js";
import { EXECUTIVE_SUITE } from "./executiveSuite/index.js";
import { MARKET_BLISS } from "./marketBliss/index.js";
import { RLM_CREATIVE } from "./rlmCreative/index.js";
import { PAIR_PROGRAMMER } from "./pairProgrammer/index.js";
import { AGENT_SMITH } from "./agentSmith/index.js";
import { GENERIC } from "./_generic/index.js";

export const TEMPLATES: TemplateRegistry = {
  hydra: HYDRA,
  eights: EIGHTS,
  executiveSuite: EXECUTIVE_SUITE,
  marketBliss: MARKET_BLISS,
  rlmCreative: RLM_CREATIVE,
  pairProgrammer: PAIR_PROGRAMMER,
  agentSmith: AGENT_SMITH,
};

export const GENERIC_TEMPLATES: ProjectTemplates = GENERIC;

export function resolveTemplate(
  project: ConsumerProject,
  kind: ArtifactKind,
): { fn: TemplateFn; fromGeneric: boolean } {
  const projectMap = TEMPLATES[project];
  const direct = projectMap?.[kind];
  if (direct) return { fn: direct, fromGeneric: false };
  const fallback = GENERIC_TEMPLATES[kind];
  if (!fallback) {
    throw new Error(`No template available for kind=${kind} (project=${project}, generic also missing)`);
  }
  return { fn: fallback, fromGeneric: true };
}

export type { TemplateFn, TemplateResult, TemplateOptions, RiskClass } from "./types.js";
