import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ??
      `${titleCase(slug)} — Garland-crew head; TODO one-line creative scope.`,
    model: opts?.model ?? "claude-sonnet-4-6",
    color: opts?.color ?? "#7c3aed",
    tools: normalizeTools(opts?.tools) ?? [
      "Read",
      "Write",
      "Grep",
      "mcp__rlm-creative__rlm_output_write",
      "mcp__rlm-creative__rlm_output_read",
      "mcp__eights-memory__recall",
      "mcp__eights-memory__remember",
    ],
    maxTurns: opts?.maxTurns ?? 30,
    context: ["RLM/specs/creative-constitution.md", "RLM/progress/.current-context.md"],
    skills: opts?.skills ?? ["creative-brief-protocol", "brand-safety"],
  };
  const body = `# ${titleCase(slug)} — Garland Crew

\`\`\`yaml
role: ${titleCase(slug)}
goal: >
  TODO single-sentence goal — what this head delivers and into which envelope.
backstory: >
  TODO mythic origin + crew authority.
authority: execute  # execute | gatekeeper
\`\`\`

## Workflow

### 1. Intake

Receive a \`CreativeBrief\` fragment from Calliope. Read \`RLM/specs/creative-constitution.md\` and the current context file before acting.

### 2. Memory recall

\`\`\`
eights.memory.recall(
  query   = brief.objective,
  domain  = "creative",
  scopes  = ["public", "team:garland-crew"],
  k       = 5
)
\`\`\`

### 3. Produce

Author the head-specific deliverable per the brief's \`scope\` and \`due_phase\`. Honor brand-safety and IP-clearance gates.

### 4. Emit

Write the typed artifact back to Calliope as a \`DecisionRecord\` fragment via \`rlm.output.write\`.

## Output contract

\`\`\`
Emits:
  - DecisionRecord fragment (back to Calliope)

Blocks on:
  - brand-safety rubric failure
  - missing mandatory brief fields
\`\`\`
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
    description: opts?.description ?? `${titleCase(slug)} — RLM-Creative skill.`,
  },
  body: `# ${titleCase(slug)}

Creative-production skill. Document scope, recipes, templates, and the cross-head contract.

## When This Skill Loads

List Garland heads that invoke it.

## Recipes

| Recipe | Use when |
|---|---|
| TODO | TODO |

## Brand-Safety Notes

- TODO
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description:
      opts?.description ?? `Garland-crew command — TODO describe the creative lifecycle this runs.`,
    "argument-hint": "<brief-or-topic>",
    model: opts?.model ?? "opus",
    context: ["!type RLM\\specs\\creative-constitution.md"],
    skills: opts?.skills ?? ["creative-brief-protocol", "brand-safety"],
  },
  body: `# /${slug} $ARGUMENTS

You are operating as the Calliope-led crew orchestrator. Follow the steps below in order. Do not skip the governance gate. Persist the final DecisionRecord.

## Step 1 — Calliope intake

Adopt the Calliope (\`brand-strategist\`) persona. Build a Hydra \`CreativeBrief\` envelope with: \`brief_id\`, \`objective\`, \`target_audience\`, \`key_messages[]\`, \`channels[]\`, \`brand_constraints{}\`, \`assets_required[]\`, \`risk_tolerance\`, \`deadline\`.

## Step 2 — Memory recall

\`eights.memory.recall(query=brief.objective, domain="creative", k=8)\` — inject results as Prior Wisdom.

## Step 3 — Fan-out

Dispatch the relevant Garland heads in parallel. Each emits a typed artifact back to Calliope.

## Step 4 — Governance (governance-c2pa)

Score brand-safety and IP-clearance for every \`AssetJob\`. Apply C2PA signing. On failure, emit \`HITL_REQUEST\` and halt.

## Step 5 — Persist

Write the final \`DecisionRecord\` to \`RLM/output/launch/<slug>-<date>.md\`.

## Step 6 — Episodic remember

\`eights.memory.remember\` with a 300-char summary referencing the DecisionRecord id.
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — RLM-Creative hook
# Triggered by Claude Code; gates asset writes via agent allow-list + C2PA sidecar check.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ISOTimestamp { [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Write-AuditLine { param([string]$Agent, [string]$Path, [string]$Decision)
  Write-Output "$(Get-ISOTimestamp) | agent=$Agent | path=$Path | decision=$Decision"
}

$agentName = $env:CLAUDE_HOOK_AGENT_NAME
if (-not $agentName) { $agentName = $env:CLAUDE_AGENT_NAME }
if (-not $agentName) { $agentName = 'unknown' }
$agentSlug = $agentName.ToLower().Trim()

# TODO: implement the gate. Default = allow.
Write-AuditLine -Agent $agentSlug -Path '(none)' -Decision 'ALLOW'
exit 0
`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

const team: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${slug}
description: ${opts?.description ?? "TODO — RLM-Creative team."}
profiles_compatible: [creative-production, advertising-commercial]
stages:
  - kind: brief
    gate_type: spec
    generator: { agent: brand-strategist, primary: claude }
    judge:     { tier: same_vendor, rubric: creative-brief-completeness@1 }
  - kind: fan-out
    gate_type: design
    generator: { agent: brand-strategist, primary: claude }
    judge:     { tier: same_vendor, rubric: brand-consistency@1 }
  - kind: governance
    gate_type: contract
    generator: { agent: governance-c2pa, primary: claude }
    judge:     { tier: same_vendor, rubric: brand-safety@1 }
taxonomy_required: ["4.1", "4.4", "4.14"]
missability_required: ["brand-safety", "ip-clearance"]
`,
  target_subpath: `.claude/teams/${slug}.yaml`,
  risk_class: "medium",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

function normalizeTools(t: string[] | string | undefined): string[] | undefined {
  if (!t) return undefined;
  return Array.isArray(t) ? t : [t];
}

export const RLM_CREATIVE: ProjectTemplates = { agent, skill, command, hook, team };
