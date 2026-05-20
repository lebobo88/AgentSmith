import { readdirSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentSmithConfig } from "../config.js";
import type { ArtifactKind, ConsumerProject } from "../schemas/artifact.js";

export interface RegistryEntry {
  project: ConsumerProject;
  kind: ArtifactKind;
  slug: string;
  path: string;
  size_bytes: number;
  mtime: string;
}

export interface RegistrySnapshot {
  taken_at: string;
  entries: RegistryEntry[];
}

interface KindLocation {
  kind: ArtifactKind;
  dir: string;
  slugFrom: (file: string) => string | null;
}

const LOCATIONS: KindLocation[] = [
  { kind: "agent", dir: ".claude/agents", slugFrom: (f) => (f.endsWith(".md") ? f.replace(/\.md$/, "") : null) },
  {
    kind: "skill",
    dir: ".claude/skills",
    slugFrom: (f) => (f.endsWith("/SKILL.md") || f.endsWith("\\SKILL.md") ? f.replace(/[\\/]SKILL\.md$/, "") : null),
  },
  { kind: "command", dir: ".claude/commands", slugFrom: (f) => (f.endsWith(".md") ? f.replace(/\.md$/, "") : null) },
  {
    kind: "hook",
    dir: ".claude/hooks",
    slugFrom: (f) => (f.endsWith(".ps1") ? f.replace(/\.ps1$/, "") : f.endsWith(".sh") ? f.replace(/\.sh$/, "") : null),
  },
  { kind: "team", dir: ".claude/teams", slugFrom: (f) => (f.endsWith(".yaml") ? f.replace(/\.yaml$/, "") : null) },
  {
    kind: "squad",
    dir: "squads",
    slugFrom: (f) => (f.endsWith("/squad.yaml") || f.endsWith("\\squad.yaml") ? f.replace(/[\\/]squad\.yaml$/, "") : null),
  },
  { kind: "rubric", dir: "rubrics", slugFrom: (f) => (f.endsWith(".yaml") ? f.replace(/\.yaml$/, "") : null) },
];

export class Registry {
  constructor(private cfg: AgentSmithConfig) {}

  scan(projectKey?: ConsumerProject): RegistrySnapshot {
    const projects = projectKey
      ? [projectKey] as ConsumerProject[]
      : (Object.keys(this.cfg.consumerRoots) as ConsumerProject[]);

    const entries: RegistryEntry[] = [];
    for (const project of projects) {
      const root = this.cfg.consumerRoots[project];
      if (!root || !existsSync(root)) continue;
      for (const loc of LOCATIONS) {
        const dir = join(root, loc.dir);
        if (!existsSync(dir)) continue;
        for (const file of walk(dir)) {
          const rel = relative(dir, file).replace(/\\/g, "/");
          const slug = loc.slugFrom(rel);
          if (!slug) continue;
          const st = statSync(file);
          entries.push({
            project,
            kind: loc.kind,
            slug,
            path: file.replace(/\\/g, "/"),
            size_bytes: st.size,
            mtime: st.mtime.toISOString(),
          });
        }
      }
    }
    return { taken_at: new Date().toISOString(), entries };
  }

  writeCache(snapshot: RegistrySnapshot): void {
    writeFileSync(this.cfg.registryCachePath, JSON.stringify(snapshot, null, 2));
  }

  readCache(): RegistrySnapshot | null {
    if (!existsSync(this.cfg.registryCachePath)) return null;
    try {
      return JSON.parse(readFileSync(this.cfg.registryCachePath, "utf8")) as RegistrySnapshot;
    } catch {
      return null;
    }
  }
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}
