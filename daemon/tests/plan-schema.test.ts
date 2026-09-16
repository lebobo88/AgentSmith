import { describe, it, expect } from "vitest";
import { checkSchema } from "../src/inspector/schema-checks.js";
import { ARTIFACT_KINDS } from "../src/schemas/artifact.js";
import { Factory } from "../src/factory/generator.js";
import type { AgentSmithConfig } from "../src/config.js";

/**
 * Worked example produced by Hydra's `render_plan_json`
 * (`hydra_core/plan_artifact.py`, `Plan.model_dump(mode="json")`) — copied
 * from docs/plans/add-a-customer-data-export-feature-with-a-docume-5a03e1b5.json
 * in the Hydra repo. Read-only reference; do not regenerate it here.
 */
const VALID_PLAN = {
  artifact_path: null,
  authored_by: ["Pyrrha (plan-author)", "Momus (plan-critic)", "Theseus (plan-scribe)"],
  constraints: {
    budget_usd: null,
    deadline_ts: null,
    industries: [],
    priority: "P2",
    risk_tolerance: "medium",
    token_limit: null,
  },
  context_refs: [],
  created_at: "2026-09-14T08:05:14.121734Z",
  dissents: [],
  do_not_touch: [],
  external_id: null,
  goal_restatement:
    "Add a customer-data export feature with a documented size ceiling and reviewed retention posture.",
  id: "b051277f-c4a8-417e-abdf-6d75db9f85d5",
  non_goals: [
    "Import. This plan covers export only.",
    "Scheduled or recurring exports; this is on-demand only.",
  ],
  open_questions: [
    "Does the size ceiling apply per-request or per-account per-day?",
    "Which regimes are in scope for s4 — is any non-EU transfer expected?",
  ],
  origin_squad: "planning",
  parent_id: null,
  plan_revision: 1,
  rigor: "major",
  risks: [
    "A buffered implementation could exceed the memory ceiling at the maximum permitted size, which is why s2 depends on s1 rather than running beside it.",
    "The legal review can complete while implementation proceeds, but a finding could invalidate the specified surface.",
  ],
  steps: [
    {
      acceptance_criteria: [
        "Every supported format names its size ceiling",
        "A partial export reports which records were skipped and why",
      ],
      depends_on: [],
      description:
        "Specify the export surface: formats, size ceilings, and the failure modes a partial export must report.",
      envelope_type: "PRD",
      estimated_budget_usd: 3.0,
      model_tier: null,
      priority: "P2",
      rationale: null,
      step_id: "s1-prd",
      target_repo_id: null,
      target_repo_subpath: null,
      target_squad: "engineering",
      taxonomy_section: "4.3",
    },
    {
      acceptance_criteria: [
        "The decision states the memory ceiling it assumes",
        "A rejected alternative is recorded with its reason",
      ],
      depends_on: ["s1-prd"],
      description: "Decide streaming versus buffered generation against the size ceiling from s1.",
      envelope_type: "ARCH_RFC",
      estimated_budget_usd: 4.0,
      model_tier: null,
      priority: "P2",
      rationale: null,
      step_id: "s2-arch",
      target_repo_id: null,
      target_repo_subpath: null,
      target_squad: "engineering",
      taxonomy_section: "4.6",
    },
    {
      acceptance_criteria: [
        "Flag off is byte-identical to today",
        "A partial export surfaces rather than silently truncating",
      ],
      depends_on: ["s2-arch"],
      description: "Implement the exporter behind a feature flag, defaulting off.",
      envelope_type: "DEV_TASK",
      estimated_budget_usd: 8.0,
      model_tier: null,
      priority: "P2",
      rationale: null,
      step_id: "s3-impl",
      target_repo_id: null,
      target_repo_subpath: null,
      target_squad: "engineering",
      taxonomy_section: "4.8",
    },
    {
      acceptance_criteria: [
        "Each obligation cites its regime",
        "Any unresolved transfer question is surfaced, not assumed",
      ],
      depends_on: ["s1-prd"],
      description: "Review the export against retention and cross-border transfer obligations.",
      envelope_type: "HANDOFF",
      estimated_budget_usd: 2.0,
      model_tier: null,
      priority: "P2",
      rationale: null,
      step_id: "s4-legal",
      target_repo_id: null,
      target_repo_subpath: null,
      target_squad: "legal-compliance",
      taxonomy_section: null,
    },
  ],
  summary:
    "Four steps: specify the surface, decide the generation strategy against it, implement behind a default-off flag, and review the retention and transfer posture in parallel with implementation.",
  supersedes: null,
  target_squad: null,
  type: "PLAN",
  workflow_id: "a042c803-a3f8-4c9f-ac82-4d0b92087aa8",
};

function withSteps(steps: unknown[]): Record<string, unknown> {
  return { ...VALID_PLAN, steps };
}

function step(overrides: Partial<(typeof VALID_PLAN.steps)[number]>) {
  return {
    step_id: "s1",
    target_squad: "engineering",
    envelope_type: "DEV_TASK",
    description: "do the thing",
    acceptance_criteria: ["it works"],
    depends_on: [] as string[],
    ...overrides,
  };
}

describe("X2 — plan artifact kind + checkPlan validator", () => {
  it("includes 'plan' in ARTIFACT_KINDS", () => {
    expect((ARTIFACT_KINDS as readonly string[]).includes("plan")).toBe(true);
  });

  it("allows the worked Hydra PLAN example (rigor=major, 4 steps)", () => {
    const v = checkSchema({ kind: "plan", content: JSON.stringify(VALID_PLAN) });
    expect(v.outcome).toBe("allow");
    expect(v.rationale).toMatch(/major/);
    expect(v.rationale).toMatch(/4/);
  });

  it("allows a trivial-rigor plan with a step lacking acceptance criteria", () => {
    const plan = {
      ...VALID_PLAN,
      rigor: "trivial",
      steps: [step({ acceptance_criteria: [] })],
    };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("allow");
  });

  it("denies content that is not valid JSON", () => {
    const v = checkSchema({ kind: "plan", content: "{not json" });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/JSON/);
  });

  it("denies content that is not a JSON object", () => {
    const v = checkSchema({ kind: "plan", content: JSON.stringify([1, 2, 3]) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/JSON object/);
  });

  it("denies type !== PLAN", () => {
    const plan = { ...VALID_PLAN, type: "PRD" };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/"type"/);
  });

  it("denies an invalid rigor value", () => {
    const plan = { ...VALID_PLAN, rigor: "extreme" };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/rigor/);
  });

  it("denies a missing/empty goal_restatement", () => {
    const plan = { ...VALID_PLAN, goal_restatement: "   " };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/goal_restatement/);
  });

  it("denies a missing/empty summary", () => {
    const plan = { ...VALID_PLAN, summary: "" };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/summary/);
  });

  it("denies steps that is not an array", () => {
    const plan = { ...VALID_PLAN, steps: "not-an-array" };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/steps/);
  });

  it("denies a step missing step_id", () => {
    const v = checkSchema({ kind: "plan", content: JSON.stringify(withSteps([step({ step_id: "" })])) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/step_id/);
  });

  it("denies a step missing target_squad", () => {
    const v = checkSchema({
      kind: "plan",
      content: JSON.stringify(withSteps([step({ target_squad: "" })])),
    });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/target_squad/);
  });

  it("denies a step missing envelope_type", () => {
    const v = checkSchema({
      kind: "plan",
      content: JSON.stringify(withSteps([step({ envelope_type: "" })])),
    });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/envelope_type/);
  });

  it("denies a step missing description", () => {
    const v = checkSchema({
      kind: "plan",
      content: JSON.stringify(withSteps([step({ description: "" })])),
    });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/description/);
  });

  it("denies a duplicate step_id, naming the offending step", () => {
    const plan = withSteps([step({ step_id: "dup" }), step({ step_id: "dup" })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/dup/);
    expect(v.rationale).toMatch(/duplicate/);
  });

  it("denies a depends_on entry naming no known step (dangling dependency)", () => {
    const plan = withSteps([step({ step_id: "s1", depends_on: ["ghost"] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/ghost/);
  });

  it("denies a step that depends on itself", () => {
    const plan = withSteps([step({ step_id: "s1", depends_on: ["s1"] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/itself/);
  });

  it("denies a depends_on cycle", () => {
    const plan = withSteps([
      step({ step_id: "a", depends_on: ["b"] }),
      step({ step_id: "b", depends_on: ["a"] }),
    ]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/cycle/);
  });

  it("denies plan_revision present and not an integer >= 1", () => {
    const plan = { ...VALID_PLAN, plan_revision: 0 };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/plan_revision/);
  });

  it("denies plan_revision as a non-integer", () => {
    const plan = { ...VALID_PLAN, plan_revision: 1.5 };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/plan_revision/);
  });

  it("denies a major-rigor step with zero acceptance_criteria, naming the step", () => {
    const plan = { ...VALID_PLAN, rigor: "major", steps: [step({ step_id: "s1", acceptance_criteria: [] })] };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/acceptance_criteria/);
  });

  it("denies a standard-rigor step with zero acceptance_criteria", () => {
    const plan = { ...VALID_PLAN, rigor: "standard", steps: [step({ acceptance_criteria: [] })] };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/acceptance_criteria/);
  });

  it("Factory.scaffold refuses the 'plan' kind with an explicit error (no template)", () => {
    const cfg: AgentSmithConfig = {
      agentsmithHome: "/tmp/agentsmith-plan-test",
      statePath: "/tmp/agentsmith-plan-test/state.db",
      decisionsPath: "/tmp/agentsmith-plan-test/decisions.jsonl",
      quarantineDir: "/tmp/agentsmith-plan-test/quarantine",
      registryCachePath: "/tmp/agentsmith-plan-test/registry-cache.json",
      logsDir: "/tmp/agentsmith-plan-test/logs",
      constitutionPath: "/tmp/agentsmith-plan-test/constitution.md",
      consumerRoots: { agentSmith: process.cwd() },
      replicationQuotaPerScope: 4,
      keymakerScanBudgetMs: 500,
      inspectorBudgetMs: 200,
    };
    const factory = new Factory(cfg);
    expect(() =>
      factory.scaffold({ kind: "plan", slug: "some-plan", project: "agentSmith" }),
    ).toThrow(/no template available for kind=plan/i);
  });
});
