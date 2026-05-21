import { parse as parseYaml } from "yaml";
import { ZodError, type ZodTypeAny } from "zod";
import {
  ArtifactKindSchema,
  type ArtifactKind,
  type ConsumerProject,
} from "../schemas/artifact.js";
import type { SmithVerdict } from "../schemas/verdict.js";
import { PROJECT_SCHEMAS } from "./schemas/index.js";

const FRONTMATTER_FENCE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

// Kinds that ship as pure-YAML documents (no `---` fence). For these, parse the
// whole file body as YAML rather than expecting frontmatter.
const PURE_YAML_KINDS = new Set<ArtifactKind>(["team", "squad"]);

export interface SchemaCheckInput {
  kind: ArtifactKind;
  content: string;
  path?: string;
  project?: ConsumerProject;
}

/** Infer a consumer project from an artifact path; defaults to "agentSmith". */
export function inferProject(p: string | undefined): ConsumerProject {
  if (!p) return "agentSmith";
  const norm = p.replace(/\\/g, "/").toLowerCase();
  if (norm.includes("/hydra/")) return "hydra";
  if (norm.includes("/theeights/") || norm.includes("/eights/")) return "eights";
  if (norm.includes("/executivesuite/")) return "executiveSuite";
  if (norm.includes("/marketbliss/")) return "marketBliss";
  if (norm.includes("/rlm-creative/") || norm.includes("/rlmcreative/")) return "rlmCreative";
  if (norm.includes("/pair-programmer/") || norm.includes("/pairprogrammer/")) return "pairProgrammer";
  return "agentSmith";
}

export function checkSchema(input: SchemaCheckInput): SmithVerdict {
  ArtifactKindSchema.parse(input.kind);
  const now = new Date().toISOString();
  const project: ConsumerProject = input.project ?? inferProject(input.path);

  // Non-frontmatter kinds: validate with kind-specific shape rules.
  if (input.kind === "mcp") {
    return checkMcp(input.content, now);
  }
  if (input.kind === "hook") {
    return checkHook(input.content, now);
  }
  if (input.kind === "adr") {
    return checkAdr(input.content, now);
  }

  const schema = PROJECT_SCHEMAS[project]?.[input.kind];
  if (!schema) {
    return passVerdict(
      now,
      `no schema registered for (${project}, ${input.kind}) — pass`,
    );
  }

  // Extract YAML payload: fenced frontmatter for most kinds; whole document for pure YAML.
  let yamlBody: string;
  if (PURE_YAML_KINDS.has(input.kind)) {
    yamlBody = input.content;
  } else {
    const fence = input.content.match(FRONTMATTER_FENCE);
    if (!fence) {
      return failVerdict(now, `missing YAML frontmatter in ${input.kind}`);
    }
    yamlBody = fence[1] ?? "";
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBody) ?? {};
  } catch (err) {
    return failVerdict(now, `invalid YAML: ${String(err)}`);
  }

  return runZod(schema, parsed, now, project, input.kind);
}

function runZod(
  schema: ZodTypeAny,
  parsed: unknown,
  now: string,
  project: ConsumerProject,
  kind: ArtifactKind,
): SmithVerdict {
  const result = schema.safeParse(parsed);
  if (result.success) {
    return passVerdict(now, `frontmatter conforms to (${project}, ${kind}) schema`);
  }
  const summary = summarizeZodError(result.error);
  return failVerdict(
    now,
    `schema violation for (${project}, ${kind}): ${summary}`,
  );
}

function summarizeZodError(err: ZodError): string {
  return err.issues
    .map((iss) => {
      const path = iss.path.length > 0 ? iss.path.join(".") : "<root>";
      return `${path}: ${iss.message}`;
    })
    .join("; ");
}

function checkMcp(content: string, now: string): SmithVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return failVerdict(now, `mcp config is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return failVerdict(now, "mcp config must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!("mcpServers" in obj) || typeof obj.mcpServers !== "object" || obj.mcpServers === null) {
    return failVerdict(now, "mcp config missing required key: mcpServers");
  }
  return passVerdict(now, "mcp config has mcpServers map");
}

function checkHook(content: string, now: string): SmithVerdict {
  if (content.trim().length === 0) {
    return failVerdict(now, "hook script is empty");
  }
  return passVerdict(now, "hook is non-empty");
}

/**
 * ADR (Architecture Decision Record) structure validator.
 *
 * Mirrors pair-programmer's `adr_structure_lint` synonym map so ADRs that
 * pass PP's gate also pass Smith's inspect. Validates:
 *   - YAML frontmatter with required keys: status, date, deciders
 *   - status is one of: Proposed | Accepted | Superseded | Deprecated | Rejected
 *   - Required body sections (case-insensitive, synonym-tolerant):
 *     Status, Context, Decision, Consequences, Alternatives
 *   - Optional ai_provenance block is accepted but not deeply validated here.
 */
const ADR_STATUS_VALUES = ["Proposed", "Accepted", "Superseded", "Deprecated", "Rejected"] as const;

const ADR_SECTION_SYNONYMS: Record<string, readonly string[]> = {
  Status: ["Status", "State", "Decision status"],
  Context: ["Context", "Context and problem statement", "Problem statement", "Background"],
  Decision: ["Decision", "Decision outcome", "Chosen option", "Resolution"],
  Consequences: ["Consequences", "Implications", "Outcomes", "Trade-offs", "Tradeoffs"],
  Alternatives: [
    "Alternatives",
    "Alternatives considered",
    "Considered alternatives",
    "Alternative approaches",
    "Options weighed",
    "Options considered",
  ],
};
const ADR_REQUIRED_SECTIONS = Object.keys(ADR_SECTION_SYNONYMS);

// Heading parser: tolerates leading numeric prefix ("## 1. Status") AND a
// trailing parenthetical note ("## Status (accepted 2026-05-20)").
const ADR_HEADING_RE = /^(#{1,6})\s+(?:\d+\.\s*)?(.+?)\s*(?:\(([^)]*)\))?\s*$/gm;

function canonicalForAdrHeading(title: string): string | null {
  const norm = title.toLowerCase().trim();
  for (const canonical of ADR_REQUIRED_SECTIONS) {
    const synonyms = ADR_SECTION_SYNONYMS[canonical]!;
    if (synonyms.some((s) => s.toLowerCase() === norm)) return canonical;
  }
  return null;
}

function checkAdr(content: string, now: string): SmithVerdict {
  // 1. Frontmatter extraction.
  const fence = content.match(FRONTMATTER_FENCE);
  if (!fence) {
    return failVerdict(now, "ADR is missing YAML frontmatter (--- ... ---)");
  }
  let fm: Record<string, unknown>;
  try {
    const parsed = parseYaml(fence[1] ?? "") ?? {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failVerdict(now, "ADR frontmatter must be a YAML mapping");
    }
    fm = parsed as Record<string, unknown>;
  } catch (err) {
    return failVerdict(now, `ADR frontmatter is not valid YAML: ${String(err)}`);
  }

  // 2. Required frontmatter keys.
  const status = fm["status"];
  if (typeof status !== "string" || status.length === 0) {
    return failVerdict(
      now,
      `ADR frontmatter missing required field: status (one of ${ADR_STATUS_VALUES.join(", ")})`,
    );
  }
  if (!(ADR_STATUS_VALUES as readonly string[]).includes(status)) {
    return failVerdict(
      now,
      `ADR frontmatter.status="${status}" is not one of ${ADR_STATUS_VALUES.join(", ")}`,
    );
  }

  const date = fm["date"];
  if (date === undefined || date === null || (typeof date === "string" && date.length === 0)) {
    return failVerdict(now, "ADR frontmatter missing required field: date");
  }

  const deciders = fm["deciders"];
  if (!Array.isArray(deciders) || deciders.length === 0) {
    return failVerdict(
      now,
      "ADR frontmatter missing required field: deciders (must be a non-empty list)",
    );
  }

  // 3. Body sections (synonym-tolerant). Skip frontmatter region.
  const body = content.slice((fence.index ?? 0) + fence[0].length);
  const seen = new Set<string>();
  for (const m of body.matchAll(ADR_HEADING_RE)) {
    const title = (m[2] ?? "").trim();
    const canonical = canonicalForAdrHeading(title);
    if (canonical) seen.add(canonical);
  }
  const missing = ADR_REQUIRED_SECTIONS.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    return failVerdict(
      now,
      `ADR missing required sections: ${missing.join(", ")} ` +
        `(synonyms accepted — see adr_structure_lint synonym map)`,
    );
  }

  return passVerdict(
    now,
    "ADR has valid frontmatter (status/date/deciders) and required body sections",
  );
}

function passVerdict(decided_at: string, rationale: string): SmithVerdict {
  return {
    outcome: "allow",
    rationale,
    cited_invariants: [],
    evidence: [],
    decided_at,
  };
}

function failVerdict(decided_at: string, rationale: string): SmithVerdict {
  return {
    outcome: "deny",
    rationale,
    cited_invariants: ["N7"],
    suggested_fix:
      "restore conforming frontmatter; see C:/AiAppDeployments/AgentSmith/.claude/skills/cross-project-conventions/SKILL.md",
    evidence: [],
    decided_at,
  };
}
