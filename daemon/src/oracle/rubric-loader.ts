import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { repoRootDefault } from "../paths.js";

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
}

export interface Rubric {
  id: string;
  version: number;
  name: string;
  description: string;
  applies_to: string[];
  criteria: RubricCriterion[];
  pass_threshold: number;
  fail_threshold: number;
  hitl_on_fail: boolean;
}

const RUBRICS_DIR = process.env["AGENTSMITH_RUBRICS_DIR"] ?? join(repoRootDefault(), "rubrics");
const MAX_FILE_BYTES = 1024 * 1024; // 1MB cap

const cache = new Map<string, Rubric>();
let allCacheLoaded = false;

function tryRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const st = statSync(path);
    if (st.size > MAX_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function coerceRubric(raw: unknown): Rubric | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string") return null;
  const criteriaRaw = Array.isArray(r["criteria"]) ? (r["criteria"] as unknown[]) : [];
  const criteria: RubricCriterion[] = [];
  for (const c of criteriaRaw) {
    if (!c || typeof c !== "object") continue;
    const cr = c as Record<string, unknown>;
    if (typeof cr["id"] !== "string") continue;
    criteria.push({
      id: cr["id"] as string,
      name: typeof cr["name"] === "string" ? (cr["name"] as string) : (cr["id"] as string),
      description: typeof cr["description"] === "string" ? (cr["description"] as string) : "",
      weight: typeof cr["weight"] === "number" ? (cr["weight"] as number) : 1,
    });
  }
  return {
    id: r["id"] as string,
    version: typeof r["version"] === "number" ? (r["version"] as number) : 1,
    name: typeof r["name"] === "string" ? (r["name"] as string) : (r["id"] as string),
    description: typeof r["description"] === "string" ? (r["description"] as string) : "",
    applies_to: Array.isArray(r["applies_to"]) ? (r["applies_to"] as string[]).filter((x) => typeof x === "string") : [],
    criteria,
    pass_threshold: typeof r["pass_threshold"] === "number" ? (r["pass_threshold"] as number) : 4.0,
    fail_threshold: typeof r["fail_threshold"] === "number" ? (r["fail_threshold"] as number) : 3.0,
    hitl_on_fail: typeof r["hitl_on_fail"] === "boolean" ? (r["hitl_on_fail"] as boolean) : true,
  };
}

function candidateFileNames(id: string): string[] {
  // Caller may pass "smith-foo" or "smith-foo@1"
  const names = new Set<string>();
  names.add(`${id}.yaml`);
  names.add(`${id}.yml`);
  if (!/@\d+$/.test(id)) {
    names.add(`${id}@1.yaml`);
    names.add(`${id}@1.yml`);
  }
  return [...names];
}

export function loadRubric(id: string): Rubric | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  // Also check by base id (without @version)
  const baseId = id.replace(/@\d+$/, "");
  if (cache.has(baseId)) {
    const hit = cache.get(baseId);
    if (hit) cache.set(id, hit);
    return hit ?? null;
  }
  for (const fname of candidateFileNames(id)) {
    const full = join(RUBRICS_DIR, fname);
    const text = tryRead(full);
    if (!text) continue;
    try {
      const parsed = parseYaml(text) as unknown;
      const rubric = coerceRubric(parsed);
      if (rubric) {
        cache.set(id, rubric);
        cache.set(rubric.id, rubric);
        return rubric;
      }
    } catch {
      // fall through; degraded
    }
  }
  return null;
}

export function loadAllRubrics(): Rubric[] {
  if (allCacheLoaded) {
    return [...new Set(cache.values())];
  }
  const out: Rubric[] = [];
  try {
    if (!existsSync(RUBRICS_DIR)) {
      allCacheLoaded = true;
      return out;
    }
    const entries = readdirSync(RUBRICS_DIR);
    for (const e of entries) {
      if (!/\.(ya?ml)$/i.test(e)) continue;
      const full = join(RUBRICS_DIR, e);
      const text = tryRead(full);
      if (!text) continue;
      try {
        const rubric = coerceRubric(parseYaml(text));
        if (rubric) {
          cache.set(rubric.id, rubric);
          out.push(rubric);
        }
      } catch {
        // skip degraded entry
      }
    }
  } catch {
    // degraded directory access
  }
  allCacheLoaded = true;
  return out;
}

export function clearRubricCache(): void {
  cache.clear();
  allCacheLoaded = false;
}
