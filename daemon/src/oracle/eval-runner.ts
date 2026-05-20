import type { ArtifactDraft } from "../schemas/artifact.js";
import { loadRubric, type Rubric, type RubricCriterion } from "./rubric-loader.js";

export interface EvalReport {
  artifact_draft_id: string;
  rubric_ids: string[];
  scores: Record<string, number>;
  pass: boolean;
  rationale: string;
  evaluated_at: string;
  degraded?: boolean;
}

interface DraftLike {
  draft_id?: string;
  kind?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  target_path?: string;
}

const REQUIRED_FRONTMATTER_BY_KIND: Record<string, string[]> = {
  agent: ["name", "description"],
  skill: ["name", "description"],
  command: ["name", "description"],
  hook: ["name"],
  team: ["name", "description"],
  squad: ["name", "description"],
  rubric: ["id", "version"],
  mcp: ["name"],
};

interface ParsedFrontmatter {
  ok: boolean;
  data: Record<string, unknown>;
  bodyLength: number;
  tools: string[];
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const empty: ParsedFrontmatter = { ok: false, data: {}, bodyLength: content.length, tools: [] };
  if (!content.startsWith("---")) return empty;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return empty;
  const fmText = content.slice(3, end).trim();
  const body = content.slice(end + 4);
  const data: Record<string, unknown> = {};
  let tools: string[] = [];
  // Very small YAML-ish key extractor (avoid bringing yaml here; tolerant).
  // Supports: "key: value", "key: [a, b]", "key:\n  - a\n  - b"
  const lines = fmText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1] as string;
    const rest = (m[2] ?? "").trim();
    if (rest === "") {
      // Look for a YAML block list
      const block: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j] ?? "";
        const lm = /^\s+-\s+(.*)$/.exec(ln);
        if (!lm) break;
        block.push((lm[1] ?? "").trim());
        j++;
      }
      data[key] = block.length ? block : "";
      if (key === "tools" || key === "allowed-tools") tools = block;
      i = j;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const arr = rest
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      data[key] = arr;
      if (key === "tools" || key === "allowed-tools") tools = arr;
    } else {
      data[key] = rest.replace(/^["']|["']$/g, "");
    }
    i++;
  }
  return { ok: true, data, bodyLength: body.length, tools };
}

function scoreCriterion(
  criterion: RubricCriterion,
  draft: DraftLike,
  fm: ParsedFrontmatter,
): number {
  const cid = criterion.id.toLowerCase();
  const content = draft.content ?? "";
  const kind = (draft.kind ?? "agent").toLowerCase();

  // Schema / frontmatter family
  if (cid.includes("schema") || cid.includes("frontmatter")) {
    if (!fm.ok) return 2;
    const required = REQUIRED_FRONTMATTER_BY_KIND[kind] ?? ["name"];
    const missing = required.filter((k) => !(k in fm.data));
    return missing.length === 0 ? 5 : 2;
  }

  // Voice / persona family
  if (cid.includes("voice") || cid.includes("persona")) {
    const hasSmith = /Smith|Mr\.?\s*Anderson/i.test(content);
    const hasSecondPerson = /\byou\b|\byour\b/i.test(content);
    return hasSmith || hasSecondPerson ? 4 : 3;
  }

  // Tool minimality / least-privilege
  if (cid.includes("tool") || cid.includes("least") || cid.includes("privilege") || cid.includes("minimality")) {
    const n = fm.tools.length;
    if (n === 0 || n <= 5) return 5;
    if (n <= 10) return 3;
    return 1;
  }

  // Documentation quality
  if (cid.includes("documentation") || cid.includes("doc_quality")) {
    return content.length > 500 ? 4 : 2;
  }

  // Neutral acceptable for the rest (idempotency, observability, amendment procedure,
  // signature_specificity, traceable_to_external_governance, falsifiable, etc.)
  return 4;
}

function evaluateOne(rubric: Rubric, draft: DraftLike, fm: ParsedFrontmatter) {
  const perCriterion: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;
  const breakdown: string[] = [];
  for (const c of rubric.criteria) {
    const s = scoreCriterion(c, draft, fm);
    perCriterion[c.id] = s;
    const w = c.weight > 0 ? c.weight : 0;
    weightedSum += s * w;
    totalWeight += w;
    breakdown.push(`${c.id}=${s.toFixed(1)}(w=${w})`);
  }
  const overall = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const pass = overall >= rubric.pass_threshold;
  return { perCriterion, overall, pass, breakdown };
}

export async function evaluate(
  draft: ArtifactDraft | DraftLike,
  rubric_ids: string[],
): Promise<EvalReport> {
  const d = draft as DraftLike;
  const fm = parseFrontmatter(d.content ?? "");
  const scores: Record<string, number> = {};
  const rationaleParts: string[] = [];
  let allPass = rubric_ids.length > 0;
  let degraded = false;

  for (const rid of rubric_ids) {
    const rubric = loadRubric(rid);
    if (!rubric) {
      degraded = true;
      rationaleParts.push(`rubric ${rid}: NOT FOUND (degraded)`);
      allPass = false;
      continue;
    }
    const { perCriterion, overall, pass, breakdown } = evaluateOne(rubric, d, fm);
    for (const [cid, s] of Object.entries(perCriterion)) {
      scores[`${rubric.id}.${cid}`] = s;
    }
    scores[`${rubric.id}.__overall__`] = Number(overall.toFixed(3));
    if (!pass) allPass = false;
    rationaleParts.push(
      `${rubric.id}: overall=${overall.toFixed(2)} threshold=${rubric.pass_threshold} ${pass ? "PASS" : "FAIL"} [${breakdown.join(", ")}]`,
    );
  }

  if (rubric_ids.length === 0) {
    rationaleParts.push("no rubrics requested");
    allPass = false;
    degraded = true;
  }

  const report: EvalReport = {
    artifact_draft_id: d.draft_id ?? "unknown",
    rubric_ids,
    scores,
    pass: allPass,
    rationale: rationaleParts.join(" | "),
    evaluated_at: new Date().toISOString(),
  };
  if (degraded) report.degraded = true;
  return report;
}
