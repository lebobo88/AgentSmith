import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => {
  const fm: Record<string, unknown> = {
    name: slug,
    description:
      opts?.description ?? `${titleCase(slug)} — MarketBliss specialist; TODO one-line scope.`,
    model: opts?.model ?? "sonnet",
    maxTurns: opts?.maxTurns ?? 20,
    skills: opts?.skills ?? ["marketing-expertise", "marketing-business-context"],
  };
  const body = `# ${titleCase(slug)} — MarketBliss

You are a MarketBliss specialist. State your background (years, prior brands, methodological commitments). Be deeply skeptical of vanity metrics and last-touch attribution.

## Core Responsibilities

1. Primary domain ownership
2. Co-design measurement plans with \`analytics-experimentation\`
3. Channel-specific decisions grounded in the marketing-business-context
4. Hand-off to \`marketing-supervisor\` for cross-team escalations

## Decision Framework

Document the gate your recommendations must clear. Pull from the marketing skill library.

## Communication Style

- Lead with the decision the analysis is supposed to enable
- Distinguish correlation from causation in every claim
- Always declare counterfactual and guardrails

## Collaborates With

- \`campaign-strategist\` — strategy intake
- \`analytics-experimentation\` — measurement contract
- \`brand-safety-compliance\` — regulated-claims gate
- \`marketing-supervisor\` — escalation

## Constraints

- You MUST NOT approve work that fails the brand-safety or attribution-soundness gates.
- You DO own your domain's measurement contract.

## Output

Save artifacts to: \`output/campaigns/<campaign-id>/${slug}.md\`
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
    description: opts?.description ?? `${titleCase(slug)} — MarketBliss skill.`,
  },
  body: `# ${titleCase(slug)}

MarketBliss marketing skill. Document scope, frameworks, formulas, templates, pitfalls.

## When This Skill Loads

List agents that invoke it.

## Frameworks

| Framework | Use when |
|---|---|
| TODO | TODO |

## Pitfalls

- TODO
`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description: opts?.description ?? `TODO — describe /${slug}`,
    "argument-hint": "<brief-or-topic>",
  },
  body: `# /${slug} $ARGUMENTS

MarketBliss command. Document the lifecycle: intake → research → strategy → governance → output.

## Steps

1. Parse \`$ARGUMENTS\` into a structured brief.
2. Adopt the appropriate MarketBliss agent persona.
3. Apply the relevant skill (marketing-attribution, audience-segmentation, etc.).
4. Save artifacts to \`output/campaigns/<campaign-id>/\`.
`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — MarketBliss hook\nSet-StrictMode -Version Latest\n$ErrorActionPreference = 'Stop'\n\nexit 0\n`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

const team: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${slug}
description: ${opts?.description ?? "TODO — MarketBliss team description."}
profiles_compatible: [b2b-saas, dtc-ecommerce, professional-services, regulated-health-finance, creative-production, advertising-commercial]
stages:
  - kind: discover
    gate_type: spec
    generator: { agent: spec-author, primary: claude }
    judge:     { tier: cross_vendor, rubric: marketing-brief-clarity@1, model_pref: agy }
  - kind: strategy
    gate_type: design
    generator: { agent: campaign-strategist, primary: claude }
    judge:     { tier: cross_vendor, rubric: creative-brief-completeness@1, model_pref: agy }
  - kind: governance
    gate_type: contract
    generator: { agent: brand-safety-compliance, primary: claude }
    judge:     { tier: same_vendor, rubric: regulated-claims-check@1 }
  - kind: docs
    gate_type: docs_polish
    generator: { agent: docs-author, primary: claude }
    judge:     { tier: same_vendor, rubric: brand-consistency@1 }
taxonomy_required: ["4.1", "4.2", "4.3", "4.13", "4.14"]
missability_required: ["decision-logging", "regulated-claims-coverage"]
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

export const MARKET_BLISS: ProjectTemplates = { agent, skill, command, hook, team };
