import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

/**
 * Phase 0 drift detector: compares on-disk file hash against an expected hash.
 * Phase 3 wires this to TheEights resource versions to flag unauthorized mutations.
 */
export interface DriftReport {
  path: string;
  expected_sha256: string;
  actual_sha256: string | null;
  drifted: boolean;
}

export function detectDrift(path: string, expected_sha256: string): DriftReport {
  if (!existsSync(path)) {
    return { path, expected_sha256, actual_sha256: null, drifted: true };
  }
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { path, expected_sha256, actual_sha256: actual, drifted: actual !== expected_sha256 };
}
