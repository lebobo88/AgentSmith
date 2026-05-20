---
name: agent-factory-recipes
description: Templates for the 8 artifact kinds (agent, skill, command, hook, team, squad, rubric, mcp) across the 6 sibling projects. Location conventions, frontmatter, validators, default risk class.
allowed-tools: Read, Glob, Write
---

# Agent Factory Recipes

The 8 artifact kinds Smith manufactures, validates, and ships across the 6 sibling projects.

**Sibling projects**: Hydra, TheEights, ExecutiveSuite, MarketBliss, RLM-Creative, pair-programmer.

**Common root**: `C:\AiAppDeployments\<Project>\`.

## Default evolution risk class per kind

| Kind     | Default risk_class | Why                                                       |
| -------- | ------------------ | --------------------------------------------------------- |
| agent    | high               | Defines an actor; large blast radius.                     |
| skill    | low                | Pure reference; no execution authority by itself.         |
| command  | medium             | Operator entry point; can be misused.                     |
| hook     | high               | Runs without explicit invocation; trust-on-first-use.     |
| team     | medium             | Composition of agents; inherits their authority.          |
| squad    | high               | Composition with routing + budget authority.              |
| rubric   | low                | Judging surface; affects verdicts not actions.            |
| mcp      | critical           | Adds new tool surface; capability expansion is dangerous. |

Override only via `evolution-handoff` with TheEights.

## 1. agent

| Project          | Location                                                |
| ---------------- | ------------------------------------------------------- |
| Hydra            | `<root>\agents\<slug>.yaml`                             |
| TheEights        | `<root>\agents\<slug>\agent.yaml`                       |
| ExecutiveSuite   | `<root>\execs\<role>\agent.yaml`                        |
| MarketBliss      | `<root>\analysts\<slug>.yaml`                           |
| RLM-Creative     | `<root>\studio\agents\<slug>.yaml`                      |
| pair-programmer  | `<root>\agents\<slug>.yaml`                             |

Required frontmatter: `name, role, model_tier, allowed_tools, scope, owner`.
Body skeleton: `## Purpose / ## Inputs / ## Outputs / ## Tools / ## Refusal rules`.
Validators: `agent.schema.json`, model_tier ∈ {opus, sonnet, haiku}, allowed_tools ⊆ project allowlist.

## 2. skill

All projects: `<root>\.claude\skills\<slug>\SKILL.md`.

Required frontmatter: `name, description, allowed-tools (optional)`.
Body: progressive-disclosure markdown. No execution logic.
Validators: frontmatter present, name == folder slug, no `allowed-tools` with elevated permissions unless risk_class >= medium.

## 3. command

All projects: `<root>\.claude\commands\<name>.md` (and `<root>\.claude\commands\<ns>\<name>.md` for namespaced).

Required frontmatter: `description, argument-hint (optional), allowed-tools (optional)`.
Body: the prompt body; supports `$ARGUMENTS`.
Validators: command.schema, slash-name regex `^[a-z][a-z0-9-]*$`.

## 4. hook

Registered in `<root>\.claude\settings.json` under `hooks.{PreToolUse|PostToolUse|Stop|...}`.

Required entry fields: `matcher, command, timeout (optional), description`.
Body (the command itself): PowerShell or bash script in `<root>\.claude\hooks\<name>.ps1`.
Validators: hook command exists on disk, exit code semantics documented, no unsanitized $-interpolation in PowerShell.

## 5. team

| Project          | Location                                                |
| ---------------- | ------------------------------------------------------- |
| pair-programmer  | `<root>\teams\<slug>.yaml`                              |
| ExecutiveSuite   | `<root>\teams\<slug>.yaml`                              |
| All others       | not used                                                |

Required: `name, members (list of agent slugs), stages, rubric, budget_cap`.
Validators: members exist, rubric exists, stages reference known stage kinds.

## 6. squad

| Project | Location                                  |
| ------- | ----------------------------------------- |
| Hydra   | `<root>\squads\<slug>\squad.yaml`         |

Required: `name, fingerprints (keywords), agents, router, hitl_gates, budget`.
Validators: squad.schema, fingerprints non-empty, at least one HITL gate placement.

## 7. rubric

| Project          | Location                                  |
| ---------------- | ----------------------------------------- |
| pair-programmer  | `<root>\rubrics\<slug>.yaml`              |
| Hydra            | `<root>\rubrics\<slug>.yaml`              |
| TheEights        | `<root>\evolution\rubrics\<slug>.yaml`    |

Required: `name, criteria (list with weight), scoring_scale, alignment (e.g., ISO/NIST tag)`.
Validators: weights sum to 1.0, criteria >=3.

## 8. mcp

All projects: entry in `<root>\.mcp.json` (or `<root>\.claude\mcp.json`).

Required entry: `command, args, env (optional), description, capability_class`.
Validators: capability_class ∈ {read_only, read_write, network, exec}; `exec` requires HITL per N6.

## Templates the daemon reads

```
C:\AiAppDeployments\AgentSmith\daemon\src\factory\templates\
   agent.template.yaml
   skill.template.md
   command.template.md
   hook.template.ps1
   team.template.yaml
   squad.template.yaml
   rubric.template.yaml
   mcp.template.json
```

The daemon stamps `generated_by: AgentSmith`, `generated_at: <iso>`, `constitution_hash: <hex>` into every output. Missing stamps fail validation.

## Related skills

- `cross-project-conventions` (the shared schemas referenced above)
- `evolution-handoff` (default risk_class overrides)
- `anomaly-signatures` (`schema-frontmatter-drift` catches violations)
