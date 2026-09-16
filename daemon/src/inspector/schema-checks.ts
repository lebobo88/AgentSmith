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
  if (input.kind === "plan") {
    return checkPlan(input.content, now);
  }

  const schema = PROJECT_SCHEMAS[project]?.[input.kind];
  if (!schema) {
    // AS-GV-5: N7 is fail-closed. No schema registered means we cannot verify
    // compliance — return deny/escalate citing N7 rather than silently passing.
    return {
      outcome: "escalate",
      rationale: `no schema registered for (${project}, ${input.kind}) — N7 requires compliance verification; escalating (AS-GV-5)`,
      cited_invariants: ["N7"],
      suggested_fix:
        `Register a Zod schema for (${project}, ${input.kind}) in daemon/src/inspector/schemas/index.ts to enable verification.`,
      evidence: [{ key: "project", value: project }, { key: "kind", value: input.kind }],
      decided_at: now,
    };
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

/**
 * Plan artifact validator.
 *
 * Validates the JSON companion Hydra writes for its `PLAN` envelope
 * (`hydra_core/plan_artifact.py::render_plan_json`, i.e.
 * `Plan.model_dump(mode="json")` from `hydra_core/schemas.py::Plan` /
 * `PlanStep`). This does NOT duplicate Hydra's `envelope_type` registry
 * (`SCHEMA_REGISTRY`) — a step's `envelope_type` is only checked for being a
 * non-empty string here; Hydra's own `PlanStep._known_type` validator is the
 * source of truth for which envelope types actually exist.
 *
 * Deny rules (fail-closed, N7):
 *   - content is not valid JSON, or not a JSON object
 *   - type !== "PLAN"
 *   - rigor is not one of trivial | standard | major
 *   - goal_restatement or summary is missing / empty / whitespace-only
 *   - steps is not an array
 *   - any step lacks a non-empty string step_id, target_squad, envelope_type,
 *     or description
 *   - duplicate step_id
 *   - a depends_on entry names no known step, names its own step, or the
 *     depends_on graph contains a cycle
 *   - plan_revision is present and is not an integer >= 1
 *   - rigor is standard/major and some step has zero acceptance_criteria
 */
const PLAN_RIGOR_VALUES = ["trivial", "standard", "major"] as const;

function checkPlan(content: string, now: string): SmithVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return failVerdict(now, `plan artifact is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failVerdict(now, "plan artifact must be a JSON object");
  }
  const plan = parsed as Record<string, unknown>;

  if (plan["type"] !== "PLAN") {
    return failVerdict(
      now,
      `plan artifact field "type" must be "PLAN", got ${JSON.stringify(plan["type"])}`,
    );
  }

  const rigor = plan["rigor"];
  if (typeof rigor !== "string" || !(PLAN_RIGOR_VALUES as readonly string[]).includes(rigor)) {
    return failVerdict(
      now,
      `plan artifact field "rigor" must be one of ${PLAN_RIGOR_VALUES.join(", ")}, got ${JSON.stringify(rigor)}`,
    );
  }

  const goalRestatement = plan["goal_restatement"];
  if (typeof goalRestatement !== "string" || goalRestatement.trim().length === 0) {
    return failVerdict(now, "plan artifact field \"goal_restatement\" is missing or empty");
  }

  const summary = plan["summary"];
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return failVerdict(now, "plan artifact field \"summary\" is missing or empty");
  }

  const steps = plan["steps"];
  if (!Array.isArray(steps)) {
    return failVerdict(now, "plan artifact field \"steps\" must be an array");
  }

  // Per-step shape checks.
  for (const raw of steps) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return failVerdict(now, "plan artifact has a step that is not a JSON object");
    }
    const step = raw as Record<string, unknown>;
    const stepId = step["step_id"];
    const label = typeof stepId === "string" && stepId.length > 0 ? stepId : "<unknown step>";
    for (const field of ["step_id", "target_squad", "envelope_type", "description"] as const) {
      const v = step[field];
      if (typeof v !== "string" || v.trim().length === 0) {
        return failVerdict(
          now,
          `plan step ${label} is missing required non-empty string field "${field}"`,
        );
      }
    }
  }

  // Duplicate step_id.
  const stepIds: string[] = steps.map((s) => (s as Record<string, unknown>)["step_id"] as string);
  const seen = new Set<string>();
  for (const id of stepIds) {
    if (seen.has(id)) {
      return failVerdict(now, `plan step ${id} is a duplicate step_id`);
    }
    seen.add(id);
  }
  const knownIds = seen;

  // Dependency validity: dangling refs + self-dependency.
  const dependsOnByStep = new Map<string, string[]>();
  for (const raw of steps) {
    const step = raw as Record<string, unknown>;
    const stepId = step["step_id"] as string;
    const dependsOnRaw = step["depends_on"];
    const dependsOn: string[] = Array.isArray(dependsOnRaw)
      ? dependsOnRaw.filter((d): d is string => typeof d === "string")
      : [];
    dependsOnByStep.set(stepId, dependsOn);

    if (dependsOn.includes(stepId)) {
      return failVerdict(now, `plan step ${stepId} depends on itself`);
    }
    for (const dep of dependsOn) {
      if (!knownIds.has(dep)) {
        return failVerdict(
          now,
          `plan step ${stepId} depends on unknown step_id "${dep}" (dangling dependency)`,
        );
      }
    }
  }

  // Cycle detection via DFS (white/gray/black coloring).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of stepIds) color.set(id, WHITE);
  let cycleStep: string | null = null;
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const dep of dependsOnByStep.get(id) ?? []) {
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        cycleStep = id;
        return true;
      }
      if (depColor === WHITE && visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of stepIds) {
    if (color.get(id) === WHITE && visit(id)) break;
  }
  if (cycleStep) {
    return failVerdict(now, `plan step ${cycleStep} is part of a dependency cycle`);
  }

  // plan_revision, if present, must be an integer >= 1.
  if ("plan_revision" in plan) {
    const rev = plan["plan_revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1) {
      return failVerdict(
        now,
        `plan artifact field "plan_revision" must be an integer >= 1, got ${JSON.stringify(rev)}`,
      );
    }
  }

  // The plan critic never blesses a step without an acceptance criterion at
  // standard/major rigor.
  if (rigor === "standard" || rigor === "major") {
    for (const raw of steps) {
      const step = raw as Record<string, unknown>;
      const stepId = step["step_id"] as string;
      const criteria = step["acceptance_criteria"];
      const count = Array.isArray(criteria) ? criteria.length : 0;
      if (count === 0) {
        return failVerdict(
          now,
          `plan step ${stepId} has zero acceptance_criteria, which is required at rigor="${rigor}"`,
        );
      }
    }
  }

  return passVerdict(
    now,
    `plan conforms to the Hydra PLAN envelope (rigor=${rigor}, ${steps.length} step(s))`,
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
      "restore conforming frontmatter; see .claude/skills/cross-project-conventions/SKILL.md in the AgentSmith repo",
    evidence: [],
    decided_at,
  };
}
