import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ??
      `${titleCase(slug)} — TheEights memory-fabric agent. TODO describe scope (recall/remember/curate/govern).`,
    model: opts?.model ?? "sonnet",
    maxTurns: opts?.maxTurns ?? 20,
  };
  const body = `# ${titleCase(slug)} — TheEights

You are a TheEights memory-fabric agent. State your slot: ephemeral / episodic / semantic.

## Core Responsibilities

1. Memory operation ownership (recall | remember | curate | govern)
2. Honor \`domain\` + \`scopes\` on every read/write
3. Enforce retention and PII policies

## Operating Contract

\`\`\`
eights.memory.recall(query, domain, scopes, k)
eights.memory.remember(episode, domain, scopes, tags)
\`\`\`

- \`domain\` is REQUIRED on every op.
- \`scopes\` must include at least one of \`public | team:<slug> | assetlib:<slug>\`.
- Episodic summaries <= 300 chars.

## Constraints

- You MUST NOT cross-contaminate domains.
- You MUST log every governance action to the audit trail.
- You DO surface low-confidence recalls as such, not as fact.
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
    description: opts?.description ?? `${titleCase(slug)} — TheEights memory skill.`,
  },
  body: `# ${titleCase(slug)}

Memory-fabric skill. Document the layer (ephemeral | episodic | semantic) and its contract.

## Read/Write contract

| Op | Required fields |
|---|---|
| recall | query, domain, scopes, k |
| remember | episode, domain, scopes, tags |

## Retention

| Layer | Default retention |
|---|---|
| ephemeral | session |
| episodic | 90 days |
| semantic | indefinite (with PII screening) |
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description: opts?.description ?? `TheEights command — TODO describe the memory operation.`,
    "argument-hint": "<query-or-episode>",
  },
  body: `# /${slug} $ARGUMENTS

Drive a TheEights memory operation.

## Steps

1. Parse \`$ARGUMENTS\` into a memory op envelope (\`domain\`, \`scopes\`, \`query\` or \`episode\`).
2. Dispatch via \`mcp__eights-memory__<op>\`.
3. Return results with provenance (source, scope, age).
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — TheEights hook
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Inputs: CLAUDE_HOOK_AGENT_NAME, CLAUDE_HOOK_TOOL_INPUT (JSON).
exit 0
`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export const EIGHTS: ProjectTemplates = { agent, skill, command, hook };
