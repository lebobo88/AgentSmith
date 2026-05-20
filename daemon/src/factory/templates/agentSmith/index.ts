import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ??
      `${titleCase(slug)} — AgentSmith daemon sub-agent (factory | inspector | sentinel | oracle | keymaker | archivist | quarantine).`,
    model: opts?.model ?? "sonnet",
    maxTurns: opts?.maxTurns ?? 25,
    skills: opts?.skills ?? ["matrix-invariants", "cross-project-conventions"],
  };
  const body = `# ${titleCase(slug)} — AgentSmith

You are an AgentSmith daemon sub-agent. State your subsystem (Factory / Inspector / Sentinel / Oracle / Keymaker / Archivist / Quarantine) and the N-invariant(s) you enforce.

## Operating Loop

1. **Intake** — read the request envelope. Validate against the schema in \`src/schemas/\`.
2. **Invariant check** — load \`matrix-invariants\`. Identify which of N1..N10 apply.
3. **Act** — execute the operation within budget (Keymaker 500ms, Inspector 200ms, default 2s).
4. **Record** — append a Decision Record to \`decisions.jsonl\` with verdict, evidence, invariant citations.
5. **Surface** — return the envelope; on refusal, cite the invariant id verbatim.

## Authority Bounds

- You do NOT override the constitution. Refusals cite \`smith-constitution.md\` by section.
- You do NOT modify another project's source of truth directly — propose via \`/smith:evolve\`.
- You DO quarantine on N-invariant violation (per \`quarantine-protocol\`).

## Output Contract

Every turn ends by writing a Decision Record:

\`\`\`json
{
  "decision_id": "dr_<nanoid>",
  "subsystem": "${slug}",
  "verdict": "allow|block|surface|quarantine",
  "invariants_cited": ["N3", "N7"],
  "evidence": [...],
  "ts": "ISO-8601"
}
\`\`\`
`;
  return {
    frontmatter: fm,
    body,
    target_subpath: `.claude/agents/${slug}.md`,
    risk_class: "high",
  };
};

const skill: TemplateFn = (slug, opts) => ({
  frontmatter: {
    name: slug,
    description:
      opts?.description ?? `${titleCase(slug)} — AgentSmith governance skill.`,
  },
  body: `# ${titleCase(slug)}

AgentSmith skill. Loaded on demand by daemon sub-agents.

## Scope

Document which subsystem(s) load this skill and which N-invariants it implements.

## Contract

- Every operation is auditable — emit a Decision Record.
- Refusals MUST cite the invariant id (N1..N10) and the constitution section.
- HITL is the default on \`risk_class: critical\`.

## Pitfalls

- Do not silently downgrade severity to keep things moving.
- Do not paraphrase the constitution — quote it.
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "high",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description:
      opts?.description ?? `AgentSmith command — TODO describe the governance operation.`,
    "argument-hint": "<target>",
  },
  body: `# /${slug.startsWith("smith-") ? slug.slice(6) : slug} $ARGUMENTS

Drive an AgentSmith governance operation.

## Steps

1. Parse \`$ARGUMENTS\`.
2. Load \`matrix-invariants\` to know which N-invariants apply.
3. Dispatch to the matching daemon sub-agent via \`mcp__agentsmith__<op>\`.
4. Append the Decision Record to \`decisions.jsonl\`.
5. Surface the verdict with invariant citations.

## Refusal contract

On block / quarantine, print the invariant id (e.g. \`N3: artifact-stability\`) and the constitution section. Do not paraphrase.
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "high",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — AgentSmith hook
# Exit codes: 0 = allow, 2 = block (Claude Code hard-refusal; logged as GATE_BLOCK).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ISOTimestamp { [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Write-AuditLine { param([string]$Agent, [string]$Decision)
  Write-Output "$(Get-ISOTimestamp) | hook=${slug} | agent=$Agent | decision=$Decision"
}

$agentName = $env:CLAUDE_HOOK_AGENT_NAME
if (-not $agentName) { $agentName = $env:CLAUDE_AGENT_NAME }
if (-not $agentName) { $agentName = 'unknown' }
$agentSlug = $agentName.ToLower().Trim()

# TODO: implement the N-invariant check. Cite the invariant id on refusal.
Write-AuditLine -Agent $agentSlug -Decision 'ALLOW'
exit 0
`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "critical",
});

const rubric: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `id: ${slug}
version: 1
name: ${titleCase(slug)}
description: ${opts?.description ?? "TODO — Smith rubric description."}
applies_to:
  - TODO_envelope_kind
criteria:
  - id: invariant_citation
    name: Invariant citation
    description: Verdict cites the specific N-invariant (N1..N10) it enforces, by id.
    weight: 0.25
  - id: evidence_concrete
    name: Evidence concrete
    description: Evidence chain references concrete artifact ids, sha256s, or decision-record ids — not vibes.
    weight: 0.20
  - id: severity_calibrated
    name: Severity calibrated
    description: Severity (info | warn | block | quarantine) is proportionate to blast radius and reversibility.
    weight: 0.20
  - id: mitigation_actionable
    name: Mitigation actionable
    description: Suggested remedy is concrete (specific gate, rollback, or HITL ticket) rather than "investigate".
    weight: 0.20
  - id: hitl_routing
    name: HITL routing
    description: On critical risk class, the verdict files a HITL ticket and does not auto-resolve.
    weight: 0.15
pass_threshold: 4.0
fail_threshold: 3.0
hitl_on_fail: true
`,
  target_subpath: `rubrics/${slug}.yaml`,
  risk_class: "critical",
});

const mcp: TemplateFn = (slug) => ({
  frontmatter: {},
  body: JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          command: "node",
          args: ["C:/AiAppDeployments/AgentSmith/daemon/dist/index.js"],
          env: {
            AGENTSMITH_HOME: "${HOME}/.agentsmith",
            LOG_LEVEL: "info",
          },
        },
      },
    },
    null,
    2,
  ) + "\n",
  target_subpath: `.mcp.json`,
  risk_class: "critical",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export const AGENT_SMITH: ProjectTemplates = {
  agent,
  skill,
  command,
  hook,
  rubric,
  mcp,
};
