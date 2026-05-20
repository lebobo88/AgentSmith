import type { ArtifactKind, ArtifactDraft } from "../schemas/artifact.js";
import { ArtifactDraftSchema } from "../schemas/artifact.js";

export function validateDraft(kind: ArtifactKind, draft: unknown): ArtifactDraft {
  const parsed = ArtifactDraftSchema.parse(draft);
  if (parsed.kind !== kind) {
    throw new Error(`draft kind mismatch: expected ${kind}, got ${parsed.kind}`);
  }
  return parsed;
}
