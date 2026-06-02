import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dynamic path resolution for the AgentSmith daemon.
 *
 * Every default path is derived from this module's own on-disk location so a
 * fresh `git clone` to any directory works with no hardcoded absolute paths.
 * The package is ESM (`"type": "module"` in daemon/package.json), so
 * `import.meta.url` is valid at runtime; `fileURLToPath` converts the
 * Windows `file:///C:/…` form correctly (do not hand-parse the URL).
 */

/** Directory of the compiled module: `<repo>/daemon/dist/paths.js`. */
const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Repo root, derived from this module's location.
 *   <repo>/daemon/dist/paths.js  ->  ../..  ->  <repo>
 * Returned with forward slashes for cross-platform consistency.
 */
export function repoRootDefault(): string {
  return resolve(thisDir, "..", "..").replace(/\\/g, "/");
}

/**
 * Base directory that holds the sibling projects (Hydra, TheEights, …).
 * They live adjacent to the AgentSmith clone (same parent folder), so the
 * default is the parent of the repo root.
 */
export function siblingsBaseDefault(): string {
  return dirname(repoRootDefault()).replace(/\\/g, "/");
}

/**
 * Effective consumer/sibling base: `AGENTSMITH_CONSUMER_BASE` if set, else the
 * folder adjacent to the clone. Read at call-time so tests/env can override.
 */
export function consumerBase(): string {
  return (process.env["AGENTSMITH_CONSUMER_BASE"] ?? siblingsBaseDefault()).replace(/\\/g, "/");
}

/** Join a sibling project name onto the (env-aware) consumer base. */
export function siblingPath(name: string, base = consumerBase()): string {
  return join(base, name).replace(/\\/g, "/");
}
