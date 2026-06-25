import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConstitution } from "../src/inspector/invariants.js";

function writeConstitution(path: string, heading: string, rationale: string): void {
  writeFileSync(
    path,
    `## ${heading}\n\n**Rationale.** ${rationale}\n`,
    "utf8",
  );
}

describe("getConstitution cache", () => {
  let scratch = "";

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "agentsmith-constitution-cache-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("keys the cache by path instead of reusing the first loaded snapshot", () => {
    const first = join(scratch, "first.md");
    const second = join(scratch, "second.md");
    writeConstitution(first, "N1 - First", "first rationale");
    writeConstitution(second, "N2 - Second", "second rationale with different length");

    const firstSnapshot = getConstitution(first);
    const secondSnapshot = getConstitution(second);

    expect(firstSnapshot.sha256).not.toBe(secondSnapshot.sha256);
    expect(firstSnapshot.text).toContain("First");
    expect(secondSnapshot.text).toContain("Second");
  });

  it("refreshes the cached snapshot when the file stat changes", () => {
    const constitutionPath = join(scratch, "mutable.md");
    writeConstitution(constitutionPath, "N3 - Mutable", "short");

    const firstSnapshot = getConstitution(constitutionPath);
    writeConstitution(constitutionPath, "N3 - Mutable", "much longer rationale than before");
    const secondSnapshot = getConstitution(constitutionPath);

    expect(secondSnapshot.sha256).not.toBe(firstSnapshot.sha256);
    expect(secondSnapshot.text).toContain("much longer rationale");
  });
});
