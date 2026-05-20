---
name: cross-project-conventions
description: Shared conventions across the 6 sibling AI projects. Frontmatter, .claude layout, team and command schemas, hook patterns, MCP registration, artifact directories. The default-when-unsure reference.
allowed-tools: Read, Glob
---

# Cross-Project Conventions

The lingua franca of the AgentSmith ecosystem. When in doubt about a schema, file location, or pattern, default to what is described here.

## .claude/ layout (every project)

```
<project>\
  .claude\
    settings.json              # permissions + hooks (shared)
    settings.local.json        # per-machine overrides (gitignored)
    skills\<slug>\SKILL.md
    commands\<name>.md
    commands\<ns>\<name>.md    # namespaced commands
    agents\<slug>.md           # subagent definitions (where supported)
    hooks\<name>.ps1
  .mcp.json                    # MCP servers for this project
  AGENTS.md                    # cross-tool behavioral contract
  CLAUDE.md                    # Claude-specific overlay (often a symlink-equivalent)
```

## Frontmatter schema (universal)

```yaml
---
name: <kebab-case-slug>           # MUST equal folder slug for skills/agents
description: <one line, <= 200 chars; the auto-discovery hint>
allowed-tools: <comma list>       # optional; inherit when omitted
argument-hint: <usage hint>       # commands only
model: <opus|sonnet|haiku>        # optional override
---
```

Rules:
- `name` is the join key; if it diverges from the slug, fail validation.
- `description` is what the model sees during auto-discovery. Front-load the trigger conditions.
- Never put secrets in frontmatter.

## settings.json (permissions + hooks)

```json
{
  "permissions": {
    "allow": ["Bash(git status)", "Read", "Grep"],
    "deny":  ["Bash(rm -rf *)"]
  },
  "hooks": {
    "PreToolUse":  [{ "matcher": "Bash", "command": "powershell -File .claude\\hooks\\preflight.ps1" }],
    "PostToolUse": [{ "matcher": "Edit", "command": "powershell -File .claude\\hooks\\poststamp.ps1" }],
    "Stop":        [{ "command": "powershell -File .claude\\hooks\\session-summary.ps1" }]
  },
  "env": {
    "PROJECT": "<slug>"
  }
}
```

Hook scripts MUST:
- Exit 0 on allow, non-zero on deny.
- Emit a single JSON object to stdout for structured cases.
- Use `$env:VAR` (PowerShell) — never `$VAR` (bash) on Windows hosts.

## Slash command schema

`<project>\.claude\commands\<name>.md`:

```markdown
---
description: One line shown in /help.
argument-hint: "<scope> [--flag]"
allowed-tools: Read, Bash(git status), Grep
---
The prompt body. May reference $ARGUMENTS.
```

Naming: `^[a-z][a-z0-9-]*$`. Namespaced: place under a subfolder; invocation is `/<ns>:<name>`.

## Team yaml schema (pair-programmer, ExecutiveSuite)

```yaml
name: <slug>
description: <one line>
members:
  - agent: <agent-slug>
    role: <generator|judge|critic|...>
stages:
  - id: <slug>
    kind: <generate|judge|reflect|finalize>
    rubric: <rubric-slug>
budget_cap: <usd>
risk_class: <low|medium|high|critical>
```

## Squad yaml schema (Hydra only)

```yaml
name: <slug>
fingerprints: [<keyword>, ...]
agents:
  - <agent-slug>
router:
  kind: <keyword|llm|hybrid>
hitl_gates:
  - placement: <pre_dispatch|post_synthesis|on_budget_100>
budget:
  cap_usd: <n>
  tripwire_pct: 80
```

## MCP server registration (`.mcp.json`)

```json
{
  "mcpServers": {
    "<name>": {
      "command": "<exe>",
      "args": ["..."],
      "env": { "API_KEY": "${env:API_KEY}" },
      "description": "One line.",
      "capability_class": "read_only | read_write | network | exec"
    }
  }
}
```

`capability_class: exec` requires HITL approval per N6 + `evolution-handoff` with risk_class=critical.

## Artifact directories (where outputs land)

| Project          | Artifacts root                           |
| ---------------- | ---------------------------------------- |
| Hydra            | `<root>\workflows\<id>\artifacts\`       |
| TheEights        | `<root>\evolution\proposals\<id>\`       |
| ExecutiveSuite   | `<root>\memos\<yyyymmdd>\`               |
| MarketBliss      | `<root>\reports\<ticker>\<yyyymmdd>\`    |
| RLM-Creative     | `<root>\studio\renders\<project>\`       |
| pair-programmer  | `<root>\.harness\runs\<id>\artifacts\`   |
| AgentSmith       | `<root>\audit\<yyyymmdd>\` (read-only)   |

## Universal stamps

Smith stamps generated artifacts with:

```yaml
generated_by: AgentSmith
generated_at: <ISO-8601>
constitution_hash: <hex>
risk_class: <low|medium|high|critical>
```

Missing stamps trigger `schema-frontmatter-drift`.

## Related skills

- `agent-factory-recipes` (the per-kind specifics)
- `anomaly-signatures` (what schema violations look like)
