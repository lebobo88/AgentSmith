import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  SmithInvariantSchema,
  type SmithInvariant,
  type SmithConstitutionSnapshot,
} from "../schemas/invariant.js";

/**
 * Loads `smith-constitution.md` and returns an immutable, hash-bound snapshot.
 *
 * Two extraction modes are supported, in order of preference:
 *   1. An optional ```yaml invariants ... ``` fence (structured override).
 *   2. Prose H2 headings of the form `## N<n> — <name>` followed by
 *      `**Statement.**` and `**Rationale.**` paragraphs. This is the canonical
 *      authoring style; the parser reads it directly so the document stays
 *      human-readable.
 */
export function loadConstitution(path: string): SmithConstitutionSnapshot {
  const text = readFileSync(path, "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  const invariants = extractFromYamlFence(text) ?? extractFromProse(text);
  return {
    text,
    sha256,
    invariants,
    loaded_at: new Date().toISOString(),
  };
}

function extractFromYamlFence(text: string): SmithInvariant[] | null {
  const match = text.match(/```yaml\s+invariants\s+([\s\S]*?)```/);
  if (!match || !match[1]) return null;
  const parsed = parseYaml(match[1]);
  if (!Array.isArray(parsed)) return null;
  return parsed.map((raw) => SmithInvariantSchema.parse(raw));
}

const PROSE_HEADING_RE = /^##\s+(N\d{1,3})\s+[—–-]\s+(.+?)\s*$/gm;

function extractFromProse(text: string): SmithInvariant[] {
  const out: SmithInvariant[] = [];
  const headings = Array.from(text.matchAll(PROSE_HEADING_RE));
  for (let i = 0; i < headings.length; i++) {
    const m = headings[i];
    if (!m || m.index === undefined) continue;
    const id = m[1] ?? "";
    const name = (m[2] ?? "").trim();
    const next = headings[i + 1];
    const end = next?.index ?? text.length;
    const body = text.slice(m.index + m[0].length, end);
    const rationale = pickParagraph(body, /\*\*Rationale\.\*\*\s*([\s\S]+?)(?:\n\n|---|$)/);
    out.push({
      id,
      name,
      rationale: rationale || "(rationale not present in constitution body)",
      enforcement: "fail_closed",
      authority: "constitution",
      amendable: true,
      references: [],
    });
  }
  return out;
}

function pickParagraph(body: string, re: RegExp): string {
  const m = body.match(re);
  return m && m[1] ? m[1].trim() : "";
}

let cached: SmithConstitutionSnapshot | null = null;

export function getConstitution(path: string, refresh = false): SmithConstitutionSnapshot {
  if (!cached || refresh) {
    cached = loadConstitution(path);
  }
  return cached;
}
