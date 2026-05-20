import type { ArtifactKind, ConsumerProject } from "../schemas/artifact.js";
import type { SmithVerdict } from "../schemas/verdict.js";
import { checkSchema } from "./schema-checks.js";
import { crossCheckPolicy } from "./policy-cross-check.js";
import { getConstitution } from "./invariants.js";
import type { AgentSmithConfig } from "../config.js";

export interface InspectInput {
  kind: ArtifactKind;
  content: string;
  path?: string;
  id?: string;
  project?: ConsumerProject;
}

export class Inspector {
  constructor(private cfg: AgentSmithConfig) {}

  async inspect(input: InspectInput): Promise<SmithVerdict> {
    const schemaVerdict = checkSchema({
      kind: input.kind,
      content: input.content,
      path: input.path,
      project: input.project,
    });
    if (schemaVerdict.outcome === "deny") return schemaVerdict;
    const policyVerdict = await crossCheckPolicy({
      kind: input.kind,
      id: input.id ?? input.path ?? "anonymous",
      payload: input.content,
    });
    return policyVerdict.outcome === "deny" ? policyVerdict : schemaVerdict;
  }

  invariants() {
    return getConstitution(this.cfg.constitutionPath).invariants;
  }

  constitutionHash() {
    return getConstitution(this.cfg.constitutionPath).sha256;
  }
}

export { checkSchema, crossCheckPolicy, getConstitution };
