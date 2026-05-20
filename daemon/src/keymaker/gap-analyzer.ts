import type { ConsumerProject, ArtifactKind } from "../schemas/artifact.js";
import type { RegistrySnapshot } from "./registry.js";

export interface MissingArtifact {
  project: ConsumerProject;
  kind: ArtifactKind;
  slug: string;
  reason: string;
  suggested_command: string;
}

/**
 * Phase 0 stub. Phase 2 will compare against per-project expected-manifests
 * and against squad.yaml accepts/emits to find missing handlers.
 */
export function analyzeGaps(snapshot: RegistrySnapshot, project?: ConsumerProject): MissingArtifact[] {
  const missing: MissingArtifact[] = [];
  const byProject = new Map<ConsumerProject, Set<string>>();
  for (const e of snapshot.entries) {
    if (project && e.project !== project) continue;
    const key = `${e.kind}:${e.slug}`;
    if (!byProject.has(e.project)) byProject.set(e.project, new Set());
    byProject.get(e.project)!.add(key);
  }
  for (const [proj, present] of byProject) {
    if (!present.has("agent:smith-architect")) {
      missing.push({
        project: proj,
        kind: "agent",
        slug: "smith-architect",
        reason: "no smith-architect agent registered for this project",
        suggested_command: `/smith:scaffold agent smith-architect --project=${proj}`,
      });
    }
  }
  return missing;
}
