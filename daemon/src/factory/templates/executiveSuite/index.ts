import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ??
      `${titleCase(slug)} — TODO one-line domain summary, decision framework, and headline authority.`,
    model: opts?.model ?? "opus",
    maxTurns: opts?.maxTurns ?? 25,
    skills: opts?.skills ?? ["executive-protocol"],
  };
  const body = `# ${titleCase(slug)}

You are the ${titleCase(slug)}. State 20+ years of relevant domain experience, credentials, and the stakeholder hierarchy you serve.

## Core Responsibilities

1. Primary domain ownership
2. Cross-functional collaboration with peer executives
3. Risk-adjusted recommendations into the boardroom
4. Reporting and audit-trail for material decisions

## Decision Framework

Document the gate every material recommendation must clear (criteria + weights + thresholds). Reference deterministic tools from the matching skill.

## Communication Style

- Recommendation first, then options, then rationale
- Quantify when possible; name the uncertainty when not
- One paragraph is the standard

## Collaborates With

- \`ceo\` — strategic alignment
- \`cfo\` — financial guardrails
- \`boardroom\` — cross-functional synthesis

## Constraints

- You do NOT make decisions outside your domain.
- You DO have block authority on hard guardrails within your domain.

## Output

Save artifacts to: \`output/${slug}/\`
Follow Executive Memo Format from \`executive-protocol\`.
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
    description: opts?.description ?? `${titleCase(slug)} — TODO scope sentence and primary callers.`,
    "allowed-tools": ["Read", "Write", "Glob", "Grep"],
  },
  body: `# ${titleCase(slug)}

Loaded by executive agents on demand. Document: scope, frameworks, formulas, templates, and pitfalls.

## When This Skill Loads

List the agents that invoke it and the trigger keywords.

## Core Frameworks

| Framework | Use when | Owner |
|---|---|---|
| TODO | TODO | TODO |

## Templates

Provide the canonical templates callers must follow.

## Pitfalls

- TODO
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description: opts?.description ?? `TODO — describe /${slug}`,
  },
  body: `# /${slug}

Convene the relevant executive(s) on a topic.

## Usage

\`\`\`
/${slug} <topic>
\`\`\`

## Instructions to Claude

1. Adopt the relevant executive persona from \`.claude/agents/\`.
2. Apply the executive's decision framework.
3. Produce output in Executive Memo Format from \`skills/executive-protocol/SKILL.md\`.
4. Save to \`output/${slug}/<topic-kebab>-YYYY-MM-DD.md\`.
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — ExecutiveSuite hook\nSet-StrictMode -Version Latest\n$ErrorActionPreference = 'Stop'\n\n# Audit-trail any executive memo write.\nexit 0\n`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export const EXECUTIVE_SUITE: ProjectTemplates = { agent, skill, command, hook };
