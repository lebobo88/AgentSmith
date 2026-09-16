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
 * Deny rules (fail-closed, N7). Some of these mirror Hydra's Pydantic schema
 * exactly (a value Hydra itself would reject at construction); others are a
 * deliberately STRICTER governance policy layered on top of a schema-valid
 * document. Each rule below is labeled accordingly:
 *   - content is not valid JSON, or not a JSON object                 [shape]
 *   - type !== "PLAN"                                                 [schema]
 *   - rigor is not one of trivial | standard | major                  [schema]
 *   - goal_restatement, summary, or a step identity field (step_id,
 *     target_squad, envelope_type, description) is missing, empty, or
 *     whitespace-only                                                 [policy:
 *     Hydra's Pydantic `str` accepts "   " unchanged; a whitespace-only
 *     identity/summary field is syntactically valid but not reviewable]
 *   - steps is not an array                                           [schema]
 *   - a step is not a JSON object (denial names its array index)      [shape]
 *   - a step's depends_on is present and not an array, or contains a
 *     non-string / empty-string entry                                 [schema:
 *     Hydra's PlanStep.depends_on is `list[str]`]
 *   - a step's acceptance_criteria is present and not an array of
 *     strings                                                         [schema:
 *     Hydra's PlanStep.acceptance_criteria is `list[str]`]
 *   - duplicate step_id                                                [schema]
 *   - a depends_on entry names no known step, names its own step, or the
 *     depends_on graph contains a cycle (iterative Kahn's algorithm,
 *     mirroring `Plan._validate_dag`)                                  [schema]
 *   - plan_revision is present and is not an integer >= 1               [schema]
 *   - rigor is standard/major and some step has zero acceptance_criteria
 *     [POLICY, NOT SCHEMA: Hydra's `PlanStep.acceptance_criteria` defaults to
 *     an empty list at ANY rigor — a Hydra-schema-valid standard/major plan
 *     with an empty criteria list on a step is denied here ON PURPOSE. This
 *     is the plan-critic governance rule (acceptance criteria >= 1 enforced;
 *     the plan critic never blesses a step without one), intentionally
 *     stricter than what Hydra's Pydantic model itself requires.]
 *
 * Step/id lookups throughout use Map/Set keying (never plain-object property
 * access), so reserved-looking step ids such as "__proto__", "constructor",
 * or "toString" behave exactly like any other id.
 *
 * Any unexpected exception inside this validator is caught by the outer
 * `checkPlan` wrapper and converted to an N7 deny rather than escaping as a
 * thrown error.
 */
const PLAN_RIGOR_VALUES = ["trivial", "standard", "major"] as const;

/** Human-readable label for a step in a deny rationale: its step_id when
 * usable, otherwise its array index (e.g. for a step with a missing/blank
 * step_id, or a step that isn't even an object yet). */
function stepLabel(step: Record<string, unknown>, idx: number): string {
  const id = step["step_id"];
  return typeof id === "string" && id.trim().length > 0 ? `"${id}"` : `step[${idx}]`;
}

// POLICY: plan artifacts must be strict RFC 8259 JSON. Python's `json.dumps`
// (the serializer behind Hydra's `render_plan_json`) emits bare `NaN`,
// `Infinity`, and `-Infinity` tokens for non-finite floats by default — e.g.
// a `Constraints.budget_usd` or `PlanStep.estimated_budget_usd` that was set
// to `float("nan")`. Those tokens are NOT valid JSON (RFC 8259 numbers are
// finite only), so `JSON.parse` already rejects them. This check exists
// solely to give that rejection a specific, actionable rationale instead of
// the generic "not valid JSON" message, so the fix is obvious: re-serialize
// with finite numbers (or a JSON-legal string/null placeholder), not "make
// this parser accept NaN".
const BARE_NON_FINITE_TOKEN = /\b(?:NaN|Infinity)\b/;

/** True if `content` contains a bare (unquoted) NaN/Infinity/-Infinity token
 * outside of any JSON string literal. Strips well-formed JSON string
 * literals first (handling `\"` and other backslash escapes) so a string
 * value that merely contains the word "NaN" is not flagged. */
function hasBareNonFiniteToken(content: string): boolean {
  const withoutStrings = content.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return BARE_NON_FINITE_TOKEN.test(withoutStrings);
}

const MAX_IDS_IN_RATIONALE = 10;
const MAX_ID_LENGTH_IN_RATIONALE = 64;

/** Render a bounded, JSON-escaped list of step ids for a deny rationale.
 * Denial rationales are surfaced verbatim (logs, HITL tickets, CLI output);
 * an unbounded or adversarially long step_id must never be allowed to blow
 * up a rationale string. At most `MAX_IDS_IN_RATIONALE` ids are shown, each
 * truncated to `MAX_ID_LENGTH_IN_RATIONALE` characters, and any remainder is
 * summarized as a count rather than dropped silently. */
function formatIdListBounded(ids: readonly string[]): string {
  const shown = ids.slice(0, MAX_IDS_IN_RATIONALE).map((id) => {
    const truncated = id.length > MAX_ID_LENGTH_IN_RATIONALE ? `${id.slice(0, MAX_ID_LENGTH_IN_RATIONALE)}…` : id;
    return JSON.stringify(truncated);
  });
  const remaining = ids.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")}, and ${remaining} more` : shown.join(", ");
}

function checkPlan(content: string, now: string): SmithVerdict {
  try {
    return checkPlanInner(content, now);
  } catch (err) {
    // Fail-closed: a bug in this validator (or a pathological input it
    // doesn't anticipate) must never escape as a thrown error — it becomes
    // an N7 deny, just like every other rule violation above.
    return failPlanVerdict(
      now,
      `plan artifact validation raised an unexpected error: ${String(err)}`,
    );
  }
}

function checkPlanInner(content: string, now: string): SmithVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    if (hasBareNonFiniteToken(content)) {
      return failPlanVerdict(
        now,
        "plan artifact is not valid JSON: contains a bare NaN/Infinity/-Infinity token " +
          "(policy: plan JSON must be strict RFC 8259 JSON — non-finite numbers are " +
          "unsupported in plan JSON; re-serialize with finite numbers or a JSON-legal " +
          "string/null placeholder)",
      );
    }
    return failPlanVerdict(now, `plan artifact is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failPlanVerdict(now, "plan artifact must be a JSON object");
  }
  const plan = parsed as Record<string, unknown>;

  if (plan["type"] !== "PLAN") {
    return failPlanVerdict(
      now,
      `plan artifact field "type" must be "PLAN", got ${JSON.stringify(plan["type"])}`,
    );
  }

  const rigor = plan["rigor"];
  if (typeof rigor !== "string" || !(PLAN_RIGOR_VALUES as readonly string[]).includes(rigor)) {
    return failPlanVerdict(
      now,
      `plan artifact field "rigor" must be one of ${PLAN_RIGOR_VALUES.join(", ")}, got ${JSON.stringify(rigor)}`,
    );
  }

  // Policy: whitespace-only is not reviewable, even though Hydra's Pydantic
  // `str` type would accept it unchanged.
  const goalRestatement = plan["goal_restatement"];
  if (typeof goalRestatement !== "string" || goalRestatement.trim().length === 0) {
    return failPlanVerdict(
      now,
      "plan artifact field \"goal_restatement\" is missing or empty (policy: whitespace-only is not reviewable)",
    );
  }

  const summary = plan["summary"];
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return failPlanVerdict(
      now,
      "plan artifact field \"summary\" is missing or empty (policy: whitespace-only is not reviewable)",
    );
  }

  const steps = plan["steps"];
  if (!Array.isArray(steps)) {
    return failPlanVerdict(now, "plan artifact field \"steps\" must be an array");
  }

  // ---- Single indexed pass: per-step shape validation. ----
  const stepIds: string[] = [];
  const dependsOnByStep = new Map<string, string[]>();
  const acceptanceCountByStep = new Map<string, number>();

  for (let idx = 0; idx < steps.length; idx++) {
    const raw = steps[idx];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return failPlanVerdict(now, `plan artifact step[${idx}] is not a JSON object`);
    }
    const step = raw as Record<string, unknown>;
    const label = stepLabel(step, idx);

    for (const field of ["step_id", "target_squad", "envelope_type", "description"] as const) {
      const v = step[field];
      if (typeof v !== "string" || v.trim().length === 0) {
        return failPlanVerdict(
          now,
          `plan step ${label} is missing required non-empty string field "${field}" ` +
            "(policy: whitespace-only is not reviewable)",
        );
      }
    }
    const stepId = step["step_id"] as string;

    // depends_on: Hydra's PlanStep.depends_on is `list[str]`. A non-array,
    // or an array with a non-string / empty-string entry, is a value Hydra
    // itself cannot construct — deny, do not silently coerce.
    const dependsOnRaw = step["depends_on"];
    let dependsOn: string[];
    if (dependsOnRaw === undefined) {
      dependsOn = [];
    } else if (!Array.isArray(dependsOnRaw)) {
      return failPlanVerdict(
        now,
        `plan step ${label} field "depends_on" must be an array, got ${typeof dependsOnRaw}`,
      );
    } else {
      dependsOn = [];
      for (const d of dependsOnRaw) {
        if (typeof d !== "string" || d.trim().length === 0) {
          return failPlanVerdict(
            now,
            `plan step ${label} field "depends_on" must contain only non-empty step_id strings, ` +
              `got ${JSON.stringify(d)}`,
          );
        }
        dependsOn.push(d);
      }
    }

    // acceptance_criteria: also `list[str]` in Hydra's schema.
    const criteriaRaw = step["acceptance_criteria"];
    let criteriaCount = 0;
    if (criteriaRaw !== undefined) {
      if (!Array.isArray(criteriaRaw)) {
        return failPlanVerdict(
          now,
          `plan step ${label} field "acceptance_criteria" must be an array of strings, ` +
            `got ${typeof criteriaRaw}`,
        );
      }
      for (const c of criteriaRaw) {
        if (typeof c !== "string") {
          return failPlanVerdict(
            now,
            `plan step ${label} field "acceptance_criteria" must be an array of strings, ` +
              "got a non-string entry",
          );
        }
      }
      criteriaCount = criteriaRaw.length;
    }

    stepIds.push(stepId);
    dependsOnByStep.set(stepId, dependsOn);
    acceptanceCountByStep.set(stepId, criteriaCount);
  }

  // Duplicate step_id. Map/Set keying throughout — safe for reserved-looking
  // ids like "__proto__" / "constructor" / "toString".
  const knownIds = new Set<string>();
  for (const id of stepIds) {
    if (knownIds.has(id)) {
      return failPlanVerdict(now, `plan step "${id}" is a duplicate step_id`);
    }
    knownIds.add(id);
  }

  // Dependency validity: self-dependency + dangling refs.
  for (const id of stepIds) {
    const dependsOn = dependsOnByStep.get(id) ?? [];
    if (dependsOn.includes(id)) {
      return failPlanVerdict(now, `plan step "${id}" depends on itself`);
    }
    for (const dep of dependsOn) {
      if (!knownIds.has(dep)) {
        return failPlanVerdict(
          now,
          `plan step "${id}" depends on unknown step_id "${dep}" (dangling dependency)`,
        );
      }
    }
  }

  // Cycle detection: iterative Kahn's algorithm (mirrors
  // `hydra_core/schemas.py::Plan._validate_dag`) — repeatedly drain nodes
  // with in-degree 0; anything left over is part of a cycle. Iterative, not
  // recursive DFS, so a deep acyclic chain (thousands of steps) cannot
  // overflow the call stack.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of stepIds) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const id of stepIds) {
    for (const dep of dependsOnByStep.get(id) ?? []) {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      dependents.get(dep)!.push(id);
    }
  }
  const queue: string[] = [];
  for (const id of stepIds) {
    if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  }
  const drained = new Set<string>();
  while (queue.length > 0) {
    const id = queue.pop()!;
    drained.add(id);
    for (const nxt of dependents.get(id) ?? []) {
      const deg = (inDegree.get(nxt) ?? 0) - 1;
      inDegree.set(nxt, deg);
      if (deg === 0) queue.push(nxt);
    }
  }
  const remaining = stepIds.filter((id) => !drained.has(id));
  if (remaining.length > 0) {
    return failPlanVerdict(
      now,
      `plan has a dependency cycle among steps: ${formatIdListBounded(remaining.sort())}`,
    );
  }

  // plan_revision, if present, must be an integer >= 1.
  if ("plan_revision" in plan) {
    const rev = plan["plan_revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1) {
      return failPlanVerdict(
        now,
        `plan artifact field "plan_revision" must be an integer >= 1, got ${JSON.stringify(rev)}`,
      );
    }
  }

  // GOVERNANCE POLICY, stricter than Hydra's schema (see doc comment above):
  // the plan critic never blesses a step without an acceptance criterion at
  // standard/major rigor, even though a Hydra-schema-valid Plan permits an
  // empty acceptance_criteria list at any rigor.
  if (rigor === "standard" || rigor === "major") {
    for (const id of stepIds) {
      const count = acceptanceCountByStep.get(id) ?? 0;
      if (count === 0) {
        return failPlanVerdict(
          now,
          `plan step "${id}" has zero acceptance_criteria — governance policy (stricter than ` +
            `Hydra's schema) requires >= 1 at rigor="${rigor}"`,
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

/**
 * Plan-specific deny verdict. `failVerdict`'s `suggested_fix` talks about
 * "conforming frontmatter", which is meaningless for a JSON plan artifact
 * (plans have no `---` frontmatter fence at all) — this points at Hydra's
 * actual Plan schema and a worked example instead.
 */
function failPlanVerdict(decided_at: string, rationale: string): SmithVerdict {
  return {
    outcome: "deny",
    rationale,
    cited_invariants: ["N7"],
    suggested_fix:
      "fix the plan JSON companion to match Hydra's Plan schema " +
      "(hydra_core/schemas.py::Plan / PlanStep, rendered by " +
      "hydra_core/plan_artifact.py::render_plan_json) — see docs/plans/*.json " +
      "in the Hydra repo for a worked example.",
    evidence: [],
    decided_at,
  };
}
