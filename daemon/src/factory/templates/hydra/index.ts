import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ??
      `${titleCase(slug)} — Hydra orchestrator/supervisor role. TODO describe the slot in the LangGraph state machine.`,
    model: opts?.model ?? "opus",
    maxTurns: opts?.maxTurns ?? 30,
    skills: opts?.skills ?? ["cross-squad-message", "hitl-protocol", "squad-registry-discovery"],
  };
  const body = `# ${titleCase(slug)}

You are a Hydra agent. State your slot in the supervisor lifecycle: \`intake → planning → approval → dispatch → executing → synthesis → postcheck\`.

## Operating Loop

1. **Intake** — read the goal / envelope. Validate with \`hydra_core.schemas.validate_envelope\`.
2. **Decide** — route by intent (\`hydra_core/router.py\`) or by squad capability (\`squad-registry-discovery\`).
3. **Act** — call the squad's declared \`entrypoint\` (mcp | subprocess | agent-impersonation | claude-skill | stub). Never call squad-specific tools directly.
4. **HITL** — if a gate fires, emit an \`HITL_REQUEST\` envelope and PAUSE. Resume only via \`/hydra:approve\` or \`/hydra:resume\`.
5. **Emit** — typed envelope (PRD / ARCH_RFC / SHOT_LIST / ASSET_JOB / DECISION_RECORD / HANDOFF).
6. **Telemetry** — write current \`HydraState\` to \`<project>/.hydra/<workflow_id>/trace.jsonl\` via \`hydra_core.telemetry.emit\`.

## Authority Bounds

- You do NOT bypass HITL gates.
- You do NOT modify the squad registry (only \`/hydra:add-squad\` does that).
- You DO enforce budget downgrades when 80% consumed.

## Escalation

- Squad disagreement → escalate to executive squad's \`boardroom\`.
- Squad returns \`surfaced\` → HITL request to operator.
- \`entrypoint=stub\` on the critical path → surface immediately. Do not silently no-op.
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
    description: opts?.description ?? `${titleCase(slug)} — Hydra orchestration skill.`,
  },
  body: `# ${titleCase(slug)}

Hydra-side skill. Loaded by supervisor / router / synthesizer agents on demand.

## Contract

Document the envelope shapes accepted/emitted and the state-machine slot this skill governs.

## Rules

1. Validate every cross-boundary message with \`hydra_core.schemas.validate_envelope\`.
2. Honor HITL gates — never auto-approve.
3. Preserve dissenting opinions verbatim in any \`DECISION_RECORD\`.

## Memory

- Episodic writes go through \`hydra_core.memory.episodic.write\`.
- Read \`memory-handles\` skill before reading or writing semantic memory.
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description:
      opts?.description ?? `Hydra command — TODO describe the supervisor lifecycle this drives.`,
    "argument-hint": "<goal text> [--squad slug,slug] [--budget 50] [--risk low|medium|high]",
    model: opts?.model ?? "opus",
  },
  body: `# /${slug}

Drive a user goal through \`hydra_core.supervisor.build_supervisor\`. Lifecycle:

\`intake → planning → approval(?) → dispatch → executing → synthesis → postcheck\`

## Steps

1. Parse \`$ARGUMENTS\` into \`{goal, squad?, budget?, risk?}\`.
2. Adopt the \`hydra-supervisor\` agent persona (\`.claude/agents/hydra-supervisor.md\`).
3. Run the supervisor graph via the host-bound dispatcher (proxies to \`pp-daemon\`, \`hydra-memory\`, executive-suite and rlm-creative filesystem MCPs).
4. If an HITL request fires, STOP and surface — operator resumes with \`/hydra:approve\` or \`/hydra:resume\`.
5. On completion, print the final \`DECISION_RECORD\` summary + trace + archived-artifact paths.
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — Hydra hook
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Inputs: CLAUDE_HOOK_AGENT_NAME, CLAUDE_HOOK_TOOL_INPUT (JSON).
# Exit 0 = allow; exit 2 = block.
exit 0
`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

const squad: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${opts?.description ? slug : titleCase(slug)}
version: 1.0.0
deprecated_after: null   # ISO date or null
description: >
  ${opts?.description ?? "TODO — squad description."}
source_pack: ""
entrypoint: stub   # mcp | subprocess | agent-impersonation | claude-skill | stub
best_of_n: 1
industries: []

agents:
  - slug: lead
    role: "Crew lead — TODO"
    authority: gatekeeper
    model_tier: opus
    agent_file: .claude/agents/lead.md

tools: []

accepts:
  - HANDOFF

emits:
  - DECISION_RECORD

gates:
  - rubric_id: TODO
    when: always

invoke:
  command_hint: "/${slug}"
  fallback_commands: []
  output_dir: "output/${slug}/{topic}-{date}.md"
`,
  target_subpath: `squads/${slug}/squad.yaml`,
  risk_class: "medium",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export const HYDRA: ProjectTemplates = { agent, skill, command, hook, squad };
