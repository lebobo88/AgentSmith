import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    model: opts?.model ?? "claude-sonnet-4-6",
    description:
      opts?.description ??
      `${titleCase(slug)} — pair-programmer harness sub-agent. Used by team-driven stages (taxonomy TODO). Output is TODO.`,
    tools:
      typeof opts?.tools === "string"
        ? opts.tools
        : (opts?.tools ?? [
            "Read",
            "Glob",
            "Grep",
            "mcp__pp_codex__generate",
            "mcp__pp_harness__archive_artifact",
            "mcp__pp_harness__record_attempt",
          ]).join(", "),
  };
  const body = `You are the ${slug}. Document the artifact you produce and the gate it must clear.

## Inputs

- \`run_id\`, \`stage_id\`, \`request_text\`, \`cwd\`, \`artifact_dir\`
- \`spec_artifact_path\` (optional) — earlier-stage output to ground in
- \`agents_md_path\` — absolute path to \`<project>/AGENTS.md\`; read it first
- \`profile\` — active profile name (or null for generic mode)

## Procedure

0. Read AGENTS.md if \`agents_md_path\` is set. Any decision contradicting AGENTS.md needs an explicit "Supersedes AGENTS.md §<section>" note.
1. Read prior-stage artifacts (Glob + Read) before writing.
2. Compose the artifact in the canonical format for this kind.
3. Archive under \`<run_id>/<stage>/attempt-<n>.<ext>\` with the right \`kind:\` so the validator gate finds it.
4. \`mcp__pp_harness__record_attempt(stage_id, attempt_id, …)\`.
5. Return the standard generator handoff envelope: \`{ run_id, stage_id, attempt_id, artifact_path, summary }\`.

## Constraints

- One artifact per stage attempt. Do NOT bundle.
- Honor the Reflexion ×1 invariant: on retry, the critique appears in the prompt; do not start over.
- Never archive paths inside an active best-of-N candidate worktree — those reach the project tree via \`archive_winner_and_losers\`.

## Post-archive validator

If this stage has a registered validator, the team driver calls \`mcp__pp_harness__artifact_validate({ stage_id, kind: "<kind>_lint" })\`. On \`violation\`, the driver re-invokes you with the linter output as critique under the Reflexion ×1 rule.
`;
  return {
    frontmatter: fm,
    body,
    target_subpath: `.claude/agents/${slug}.md`,
    risk_class: "medium",
  };
};

const skill: TemplateFn = (slug, opts) => ({
  frontmatter: {
    name: slug,
    description:
      opts?.description ?? `${titleCase(slug)} — pair-programmer skill. Loaded on demand by the master \`pair-programmer\` skill.`,
  },
  body: `# ${titleCase(slug)}

Pair-programmer harness skill. Document scope, the daemon contract, and the artifact conventions this skill enforces.

## File layout

All files under \`<project>/.harness/<run_id>/\` MUST be written via \`mcp__pp_harness__archive_artifact\` (which secret-scans, sha-registers, and refuses paths inside active best-of-N candidate worktrees).

## What to pass \`archive_artifact\`

\`\`\`jsonc
{
  "run_id":           "run_xxx",
  "stage_id":         "stage_yyy",
  "taxonomy_section": "4.3",
  "kind":             "TODO_canonical_kind",
  "relative_path":    "TODO/attempt-1.md",
  "bytes":            "<utf-8 text>"
}
\`\`\`

## Reflexion ×1 invariant

Generators get exactly one retry with the judge's critique injected. After that, the stage is surfaced.
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description:
      opts?.description ?? `pair-programmer command — TODO describe the lifecycle this runs.`,
    "argument-hint": "<free-text request>",
  },
  body: `# /${slug.startsWith("pp-") ? slug.slice(3) : slug} $ARGUMENTS

Drive a pair-programmer lifecycle. Follow the \`pair-programmer\` skill protocol exactly.

**Delegation contract:** All MCP tool access flows through sub-agent delegation per the Delegation Contract in \`pair-programmer.md\`. Do not bypass.

## Lifecycle

1. **Triage** — \`Task(triage, request_text=$ARGUMENTS)\` → \`{class, signals}\`.
2. **Profile snapshot** — \`Task(profile-loader, cwd, request_text)\`. Bootstrap if \`source = "needs_bootstrap"\`.
3. **Start run** — \`mcp__pp_harness__start_run(request_text, project_path, mode="single")\`.
4. **Taxonomy mapping** — \`Task(taxonomy-mapper, …)\` → \`record_taxonomy_mapping\`.
5. **Ensure AGENTS.md / CLAUDE.md** — \`mcp__pp_harness__ensure_agents_md(...)\` (idempotent).
6. **Stage loop** — for each stage: \`start_stage → gate_eligible_judges → generator → judge-router → judge → on pass: get_stage_finalize_readiness → finalize_stage; on fail/revise: reflexion-coach (×1)\`.
7. **Missability** — \`Task(missability-inspector, …)\` → \`run_missability_checks\`.
8. **Master-plan patch** — \`Task(master-plan-patcher, …)\`.
9. **Finalize** — \`Task(run-finalizer, …)\`.
10. **Report** — print per-stage table, artifact paths, master-plan delta, missability summary, tokens/cost.

## Failure handling

- Harness error → \`finalize_run(status="aborted")\` + STOP.
- Judge tool failed (\`judge_tool_failed=true\`) → archive failure context, finalize stage \`surfaced\`, run \`aborted\`. Do NOT Reflexion.
- Missability fail → finalize \`surfaced\`.
`,
  target_subpath: `.claude/commands/pp/${slug.startsWith("pp-") ? slug.slice(3) : slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — pair-programmer hook
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Inputs: CLAUDE_HOOK_AGENT_NAME, CLAUDE_HOOK_TOOL_INPUT (JSON).
# Exit 0 = allow; exit 2 = block (hard refusal).
exit 0
`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

const team: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${slug}
description: ${opts?.description ?? "TODO — pair-programmer team."}
profiles_compatible: [web-ui, api-platform, internal-tool, mobile, ai-agentic]
stages:
  - kind: spec
    gate_type: spec
    generator: { agent: spec-author, primary: claude, fallback: codex }
    judge:     { tier: cross_vendor, rubric: rfc-2119-normative@1, model_pref: agy }
  - kind: architecture
    gate_type: design
    generator: { agent: architect, primary: claude }
    judge:     { tier: cross_vendor, rubric: c4-system-context@1, model_pref: codex }
  - kind: contracts
    gate_type: contract
    generator: { agent: api-designer, primary: codex }
    judge:     { tier: cross_vendor, rubric: openapi-3.1-stability@1, model_pref: agy }
  - kind: code
    gate_type: code_style
    generator: { agent: engineer, primary: codex }
    judge:     { tier: same_vendor, model_pref: codex_alt_model }
  - kind: tests
    artifact_kind: test_plan
    gate_type: contract
    generator: { agent: test-strategist, primary: codex }
    judge:     { tier: cross_vendor, model_pref: agy }
  - kind: docs
    gate_type: docs_polish
    generator: { agent: docs-author, primary: claude }
    judge:     { tier: same_vendor, model_pref: claude_alt_model }
taxonomy_required: ["4.3", "4.6", "4.7", "4.10", "4.13"]
missability_required: ["nfrs-declared", "decision-logging", "test-data-management"]
`,
  target_subpath: `.claude/teams/${slug}.yaml`,
  risk_class: "medium",
});

const rubric: TemplateFn = (slug, opts) => ({
  frontmatter: {
    id: `${slug}@1`,
    bare_id: slug,
    kind: "spec",
    version: 1,
    title: opts?.description ?? `${titleCase(slug)} — TODO judge prompt title.`,
    source_url: "",
    generated_by: "agentsmith Factory",
    note: "Mirror in daemon/src/rubrics/registry.ts if this becomes canonical.",
  },
  body: `# ${titleCase(slug)} rubric

For artifacts that claim coverage of this rubric:

- **dimension_1**: TODO describe what scoring 1.0 looks like.
- **dimension_2**: TODO.
- **dimension_3**: TODO.
- **dimension_4**: TODO.
- **dimension_5**: TODO.

Outcome:
- pass: every dimension >= 0.7.
- revise: any in [0.5, 0.7).
- fail: dimension_1 < 0.5.
`,
  target_subpath: `.claude/rubrics/${slug}.md`,
  risk_class: "medium",
});

const mcp: TemplateFn = (slug) => ({
  frontmatter: {},
  body: JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          command: "node",
          args: ["dist/index.js"],
          env: { LOG_LEVEL: "info" },
        },
      },
    },
    null,
    2,
  ) + "\n",
  target_subpath: `.mcp.json`,
  risk_class: "high",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export const PAIR_PROGRAMMER: ProjectTemplates = {
  agent,
  skill,
  command,
  hook,
  team,
  rubric,
  mcp,
};
