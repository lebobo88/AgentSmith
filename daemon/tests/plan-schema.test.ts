import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSchema } from "../src/inspector/schema-checks.js";
import { ARTIFACT_KINDS } from "../src/schemas/artifact.js";
import { Factory } from "../src/factory/generator.js";
import { Registry } from "../src/keymaker/registry.js";
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

  it("denies a standard-rigor step with zero acceptance_criteria — the default Hydra shape — " +
    "citing governance policy, not schema parity", () => {
    // `PlanStep.acceptance_criteria: list[str] = Field(default_factory=list)`
    // — an empty list here is exactly what a fresh Hydra PlanStep looks like
    // before the plan author fills it in. Hydra's schema alone allows this;
    // this deny is a deliberate, stricter governance policy on top of it.
    const plan = { ...VALID_PLAN, rigor: "standard", steps: [step({ acceptance_criteria: [] })] };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/acceptance_criteria/);
    expect(v.rationale).toMatch(/governance policy/i);
    expect(v.rationale).toMatch(/stricter/i);
  });

  it("denies non-array depends_on on a step", () => {
    const plan = withSteps([step({ step_id: "s1", depends_on: {} as unknown as string[] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/depends_on/);
    expect(v.rationale).toMatch(/array/);
  });

  it("denies a depends_on array containing a non-string entry", () => {
    const plan = withSteps([step({ step_id: "s1", depends_on: [42] as unknown as string[] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/depends_on/);
  });

  it("denies a depends_on array containing an empty-string entry", () => {
    const plan = withSteps([step({ step_id: "s1", depends_on: [""] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/depends_on/);
  });

  it("denies non-array acceptance_criteria on a step", () => {
    const plan = withSteps([
      step({ step_id: "s1", acceptance_criteria: "not-an-array" as unknown as string[] }),
    ]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/acceptance_criteria/);
  });

  it("denies acceptance_criteria containing a non-string entry", () => {
    const plan = withSteps([step({ step_id: "s1", acceptance_criteria: [42] as unknown as string[] })]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/s1/);
    expect(v.rationale).toMatch(/acceptance_criteria/);
  });

  it("allows a diamond dependency graph (a<-b,c ; b,c<-d)", () => {
    const plan = withSteps([
      step({ step_id: "d", depends_on: [] }),
      step({ step_id: "b", depends_on: ["d"] }),
      step({ step_id: "c", depends_on: ["d"] }),
      step({ step_id: "a", depends_on: ["b", "c"] }),
    ]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("allow");
  });

  it("allows disconnected components in the dependency graph", () => {
    const plan = withSteps([
      step({ step_id: "a1", depends_on: [] }),
      step({ step_id: "a2", depends_on: ["a1"] }),
      step({ step_id: "b1", depends_on: [] }),
      step({ step_id: "b2", depends_on: ["b1"] }),
    ]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("allow");
  });

  for (const protoId of ["__proto__", "constructor", "toString"]) {
    it(`treats "${protoId}" as an ordinary step_id (used as an id and as a depends_on target)`, () => {
      const plan = withSteps([
        step({ step_id: protoId, depends_on: [] }),
        step({ step_id: "s2", depends_on: [protoId] }),
      ]);
      const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
      expect(v.outcome).toBe("allow");
    });
  }

  it("denies a non-object step, naming its array index", () => {
    const plan = withSteps(["not-an-object" as unknown as Record<string, unknown>]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/step\[0\]/);
  });

  it("denies a non-object step among valid ones, naming its index (not step_id)", () => {
    const plan = withSteps([step({ step_id: "s1" }), "not-an-object" as unknown as Record<string, unknown>]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/step\[1\]/);
  });

  it("denies a Python-style bare NaN with a rationale naming non-finite numbers as unsupported", () => {
    // `json.dumps({"estimated_budget_usd": float("nan")})` emits this exact
    // (invalid-per-RFC-8259) text — Python's json.dumps is NaN/Infinity
    // permissive by default while JSON.parse is not.
    const content = '{"type":"PLAN","estimated_budget_usd": NaN}';
    const v = checkSchema({ kind: "plan", content });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/non-finite numbers/i);
    expect(v.rationale).toMatch(/unsupported/i);
    expect(v.rationale).toMatch(/strict JSON|RFC 8259/i);
  });

  it("denies a Python-style bare Infinity with a rationale naming non-finite numbers as unsupported", () => {
    const content = '{"type":"PLAN","constraints":{"budget_usd": Infinity}}';
    const v = checkSchema({ kind: "plan", content });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/non-finite numbers/i);
    expect(v.rationale).toMatch(/unsupported/i);
  });

  it("denies a Python-style bare -Infinity with a rationale naming non-finite numbers as unsupported", () => {
    const content = '{"type":"PLAN","constraints":{"budget_usd": -Infinity}}';
    const v = checkSchema({ kind: "plan", content });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/non-finite numbers/i);
    expect(v.rationale).toMatch(/unsupported/i);
  });

  it("does not misclassify a plan whose string value merely contains the word 'NaN' as non-finite", () => {
    // Still invalid JSON (trailing comma), but for a different reason — the
    // NaN-specific rationale must not fire just because the word appears
    // inside a properly-closed string literal.
    const content = '{"type":"PLAN","goal_restatement":"the field is NaN today",}';
    const v = checkSchema({ kind: "plan", content });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).not.toMatch(/non-finite numbers/i);
  });

  it("allows a plan whose string value merely contains the word 'NaN' when the JSON is otherwise well-formed", () => {
    const plan = { ...VALID_PLAN, summary: "field named NaN is out of scope for this plan" };
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("allow");
  });

  it("gives plan denials a plan-specific suggested_fix, not the frontmatter remediation text", () => {
    const v = checkSchema({ kind: "plan", content: "{not json" });
    expect(v.outcome).toBe("deny");
    expect(v.suggested_fix).toMatch(/Plan schema|plan_artifact|docs\/plans/i);
    expect(v.suggested_fix).not.toMatch(/frontmatter/i);
  });

  it("allows a deep acyclic dependency chain (20,000 steps) without throwing, and finishes quickly", () => {
    const n = 20_000;
    const steps = Array.from({ length: n }, (_, i) =>
      step({ step_id: `s${i}`, depends_on: i === 0 ? [] : [`s${i - 1}`] }),
    );
    const plan = withSteps(steps);
    const started = Date.now();
    let v: ReturnType<typeof checkSchema>;
    expect(() => {
      v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    }).not.toThrow();
    expect(v!.outcome).toBe("allow");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("denies a deep dependency chain (20,000 steps) closed into a cycle, without throwing", () => {
    const n = 20_000;
    const steps = Array.from({ length: n }, (_, i) =>
      step({ step_id: `s${i}`, depends_on: i === 0 ? [`s${n - 1}`] : [`s${i - 1}`] }),
    );
    const plan = withSteps(steps);
    let v: ReturnType<typeof checkSchema>;
    expect(() => {
      v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    }).not.toThrow();
    expect(v!.outcome).toBe("deny");
    expect(v!.rationale).toMatch(/cycle/);
    // Bounded rationale: at most 10 step ids are listed, the rationale stays
    // well under a runaway 20,000-id join, and the remaining count is named.
    expect(v!.rationale.length).toBeLessThan(2000);
    expect(v!.rationale).toMatch(/and 19990 more/);
  });

  it("truncates a very long step id (10,000 chars) in a cycle rationale", () => {
    const longId = "s".repeat(10_000);
    const plan = withSteps([
      step({ step_id: longId, depends_on: ["s2"] }),
      step({ step_id: "s2", depends_on: [longId] }),
    ]);
    const v = checkSchema({ kind: "plan", content: JSON.stringify(plan) });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/cycle/);
    expect(v.rationale.length).toBeLessThan(2000);
    expect(v.rationale).not.toContain(longId);
  });

  describe("exception-to-deny wrapper", () => {
    it("checkSchema never throws for the 'plan' kind even on maximally malformed input", () => {
      expect(() => checkSchema({ kind: "plan", content: "" })).not.toThrow();
      expect(() => checkSchema({ kind: "plan", content: "null" })).not.toThrow();
      expect(() => checkSchema({ kind: "plan", content: "42" })).not.toThrow();
      expect(checkSchema({ kind: "plan", content: "" }).outcome).toBe("deny");
    });
  });

  describe("keymaker registry — plan location", () => {
    let scratchBase: string;

    afterEach(() => {
      if (scratchBase) rmSync(scratchBase, { recursive: true, force: true });
    });

    it("scans docs/plans/*.json as kind='plan'", () => {
      scratchBase = mkdtempSync(join(tmpdir(), "agentsmith-plan-registry-"));
      const plansDir = join(scratchBase, "docs", "plans");
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(join(plansDir, "add-a-customer-data-export-feature-with-a-docume-5a03e1b5.json"), "{}");

      const cfg: AgentSmithConfig = {
        agentsmithHome: join(scratchBase, ".agentsmith"),
        statePath: join(scratchBase, ".agentsmith", "state.db"),
        decisionsPath: join(scratchBase, ".agentsmith", "decisions.jsonl"),
        quarantineDir: join(scratchBase, ".agentsmith", "quarantine"),
        registryCachePath: join(scratchBase, ".agentsmith", "registry-cache.json"),
        logsDir: join(scratchBase, ".agentsmith", "logs"),
        constitutionPath: join(scratchBase, ".agentsmith", "constitution.md"),
        consumerRoots: { hydra: scratchBase },
        replicationQuotaPerScope: 4,
        keymakerScanBudgetMs: 500,
        inspectorBudgetMs: 200,
      };
      const registry = new Registry(cfg);
      const snapshot = registry.scan("hydra");
      const planEntries = snapshot.entries.filter((e) => e.kind === "plan");
      expect(planEntries).toHaveLength(1);
      expect(planEntries[0]?.slug).toBe("add-a-customer-data-export-feature-with-a-docume-5a03e1b5");
    });
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
