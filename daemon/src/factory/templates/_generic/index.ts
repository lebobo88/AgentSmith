import type { ProjectTemplates, TemplateFn } from "../types.js";

const agent: TemplateFn = (slug, opts) => ({
  frontmatter: {
    name: slug,
    description: opts?.description ?? `TODO — describe when to invoke ${slug}`,
    model: opts?.model ?? "sonnet",
  },
  body: `# ${slug}\n\nGeneric agent persona. Replace with: identity, core responsibilities, decision framework, communication style, collaborators, constraints, output contract.\n`,
  target_subpath: `.claude/agents/${slug}.md`,
  risk_class: "medium",
});

const skill: TemplateFn = (slug, opts) => ({
  frontmatter: {
    name: slug,
    description: opts?.description ?? `TODO — describe the ${slug} skill`,
  },
  body: `# ${slug}\n\nGeneric skill. Describe: when this skill loads, key formulas/recipes, templates, pitfalls, and the contract callers must honor.\n`,
  target_subpath: `.claude/skills/${slug}/SKILL.md`,
  risk_class: "medium",
});

const command: TemplateFn = (slug, opts) => ({
  frontmatter: {
    description: opts?.description ?? `TODO — describe /${slug}`,
    "argument-hint": "<args>",
  },
  body: `# /${slug}\n\nGeneric slash command. Replace with: parsing of $ARGUMENTS, the lifecycle steps the model should run, expected output contract, and examples.\n`,
  target_subpath: `.claude/commands/${slug}.md`,
  risk_class: "medium",
});

const hook: TemplateFn = (slug) => ({
  frontmatter: {},
  body: `# ${slug}.ps1 — generic PowerShell hook stub\nSet-StrictMode -Version Latest\n$ErrorActionPreference = 'Stop'\n\n# Inputs (Claude Code injected env vars):\n#   CLAUDE_HOOK_AGENT_NAME, CLAUDE_HOOK_TOOL_INPUT\n# Exit codes: 0 = allow, 2 = block (hard refusal)\n\nexit 0\n`,
  target_subpath: `.claude/hooks/${slug}.ps1`,
  risk_class: "high",
});

const team: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${slug}\ndescription: ${opts?.description ?? "TODO"}\nprofiles_compatible: []\nstages: []\ntaxonomy_required: []\nmissability_required: []\n`,
  target_subpath: `.claude/teams/${slug}.yaml`,
  risk_class: "medium",
});

const squad: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `name: ${slug}\nversion: 0.1.0\ndescription: ${opts?.description ?? "TODO"}\nentrypoint: stub\nagents: []\naccepts: []\nemits: []\ngates: []\n`,
  target_subpath: `squads/${slug}/squad.yaml`,
  risk_class: "medium",
});

const rubric: TemplateFn = (slug, opts) => ({
  frontmatter: {},
  body: `id: ${slug}\nversion: 1\nname: ${slug}\ndescription: ${opts?.description ?? "TODO"}\napplies_to: []\ncriteria: []\npass_threshold: 4.0\nfail_threshold: 2.0\nhitl_on_fail: false\n`,
  target_subpath: `rubrics/${slug}.yaml`,
  risk_class: "medium",
});

const mcp: TemplateFn = (slug) => ({
  frontmatter: {},
  body: JSON.stringify(
    { mcpServers: { [slug]: { command: "node", args: ["dist/index.js"] } } },
    null,
    2,
  ) + "\n",
  target_subpath: `.mcp.json`,
  risk_class: "high",
});

export const GENERIC: ProjectTemplates = {
  agent,
  skill,
  command,
  hook,
  team,
  squad,
  rubric,
  mcp,
};
