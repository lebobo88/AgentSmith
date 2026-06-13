import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentSmithConfig {
  agentsmithHome: string;
  statePath: string;
  decisionsPath: string;
  quarantineDir: string;
  registryCachePath: string;
  logsDir: string;
  constitutionPath: string;
  consumerRoots: Record<string, string>;
  replicationQuotaPerScope: number;
  keymakerScanBudgetMs: number;
  inspectorBudgetMs: number;
}

/** Sibling directory names under the shared AIAPP_BASE, by camelCase slug. */
const SIBLING_DIR_NAMES: Record<string, string> = {
  hydra: "Hydra",
  eights: "TheEights",
  executiveSuite: "ExecutiveSuite",
  marketBliss: "MarketBliss",
  rlmCreative: "RLM-Creative",
  pairProgrammer: "pair-programmer",
};

let cachedRepoRoot: string | undefined;

/**
 * Sentinels that mark the AgentSmith REPO root (distinct from the inner
 * `daemon/` npm package, which is the only dir carrying a `package.json`). The
 * repo root is the dir that holds the `daemon/` subdir plus at least one of
 * these markers.
 */
const REPO_ROOT_MARKERS = [".git", "AGENTS.md", "rubrics", "squads"] as const;

/**
 * Resolve the AgentSmith repo root.
 *
 * Resolution order:
 *   1. `AGENTSMITH_REPO` env (tier-1 explicit override).
 *   2. Anchor-walk: starting from this module's directory (which is
 *      `<repoRoot>/daemon/{src,dist}` at runtime), walk up to the first
 *      ancestor that contains a `daemon/` subdir and one of REPO_ROOT_MARKERS.
 *      Fall back to the outermost ancestor containing any `package.json`.
 *   3. Throw a clear error if neither resolves — NEVER a hardcoded literal.
 */
export function repoRoot(): string {
  const fromEnv = process.env["AGENTSMITH_REPO"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (cachedRepoRoot) return cachedRepoRoot;

  // This file lives at <repoRoot>/daemon/src/config.ts (or .../dist/config.js
  // after build).
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }

  let repoMatch: string | undefined;
  let pkgFallback: string | undefined;
  let cursor = dir;
  for (let i = 0; i < 12; i += 1) {
    const hasDaemon = existsSync(join(cursor, "daemon"));
    const hasMarker = REPO_ROOT_MARKERS.some((m) => existsSync(join(cursor, m)));
    if (hasDaemon && hasMarker && !repoMatch) {
      repoMatch = cursor;
    }
    if (existsSync(join(cursor, "package.json"))) {
      pkgFallback = cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const resolved = repoMatch ?? pkgFallback;
  if (!resolved) {
    throw new Error(
      "Cannot resolve AgentSmith repo root: set AGENTSMITH_REPO env, or run from " +
        "within the repo tree (no daemon/ + repo marker, and no package.json, " +
        `found walking up from ${dir}).`,
    );
  }

  cachedRepoRoot = resolved;
  return resolved;
}

/**
 * Resolve the base directory that holds AgentSmith and its sibling projects.
 *
 * Resolution order:
 *   1. `AGENTSMITH_CONSUMER_BASE` env (tier-1 explicit override).
 *   2. `AIAPP_BASE` env (shared ecosystem convention).
 *   3. The parent directory of the repo root (`dirname(repoRoot())`).
 */
export function consumerBase(): string {
  const fromConsumer = process.env["AGENTSMITH_CONSUMER_BASE"];
  if (fromConsumer && fromConsumer.length > 0) return fromConsumer;
  const fromAiapp = process.env["AIAPP_BASE"];
  if (fromAiapp && fromAiapp.length > 0) return fromAiapp;
  return dirname(repoRoot());
}

/**
 * Resolve every sibling consumer root under {@link consumerBase}. The
 * `agentSmith` entry always points at the repo root. Other siblings resolve to
 * `<consumerBase>/<SiblingDirName>`.
 */
export function consumerRoots(): Record<string, string> {
  const base = consumerBase();
  const roots: Record<string, string> = { agentSmith: repoRoot() };
  for (const [slug, dirName] of Object.entries(SIBLING_DIR_NAMES)) {
    roots[slug] = join(base, dirName);
  }
  return roots;
}

export function loadConfig(): AgentSmithConfig {
  const home = process.env["AGENTSMITH_HOME"] ?? join(homedir(), ".agentsmith");
  const root = repoRoot();

  return {
    agentsmithHome: home,
    statePath: join(home, "state.db"),
    decisionsPath: join(home, "decisions.jsonl"),
    quarantineDir: join(home, "quarantine"),
    registryCachePath: join(home, "registry-cache.json"),
    logsDir: join(home, "logs"),
    constitutionPath: join(root, "daemon", "src", "constitution", "smith-constitution.md"),
    consumerRoots: consumerRoots(),
    replicationQuotaPerScope: Number(process.env["AGENTSMITH_REPLICATION_QUOTA"] ?? 4),
    keymakerScanBudgetMs: 500,
    inspectorBudgetMs: 200,
  };
}
