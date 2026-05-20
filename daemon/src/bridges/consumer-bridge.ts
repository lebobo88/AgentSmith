import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentSmithConfig } from "../config.js";
import type { ConsumerProject } from "../schemas/artifact.js";

/**
 * Sandbox-contained filesystem ops on the 5 sibling project roots. Mirrors
 * TheEights' writeback safety pattern: every path is resolved + containment-checked
 * against the configured project root before any write.
 */
export class ConsumerBridge {
  constructor(private cfg: AgentSmithConfig) {}

  contains(project: ConsumerProject, candidate: string): boolean {
    const root = this.cfg.consumerRoots[project];
    if (!root) return false;
    const absRoot = resolve(root);
    const absCandidate = resolve(candidate);
    const sep = process.platform === "win32" ? "\\" : "/";
    const rootWithSep = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
    return absCandidate === absRoot || absCandidate.toLowerCase().startsWith(rootWithSep.toLowerCase());
  }

  writeDryRun(project: ConsumerProject, target_path: string, _content: string): { allowed: boolean; reason: string } {
    if (!this.contains(project, target_path)) {
      return { allowed: false, reason: `path escapes sandbox for project=${project}` };
    }
    return { allowed: true, reason: "dry-run: would write within sandbox" };
  }

  writeFile(project: ConsumerProject, target_path: string, content: string): void {
    if (!this.contains(project, target_path)) {
      throw new Error(`refused: target_path escapes sandbox for ${project} (N1 sandbox containment)`);
    }
    const dir = dirname(target_path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(target_path, content);
  }

  /**
   * Sandbox-checked read. Returns the file contents as utf-8, or null if the
   * path is outside the project root or the file does not exist. Never throws.
   */
  async readArtifact(project: ConsumerProject, relpath: string): Promise<string | null> {
    const root = this.cfg.consumerRoots[project];
    if (!root) return null;
    const abs = isAbsoluteLike(relpath) ? resolve(relpath) : resolve(join(root, relpath));
    if (!this.contains(project, abs)) return null;
    if (!existsSync(abs)) return null;
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  }
}

function isAbsoluteLike(p: string): boolean {
  return /^([a-zA-Z]:)?[\\/]/.test(p);
}
