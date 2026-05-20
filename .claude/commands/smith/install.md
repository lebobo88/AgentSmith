---
description: Install AgentSmith at Claude Code user scope (symlinks .claude/ + registers MCP + merges hooks).
argument-hint: "[--force]"
model: sonnet
---

# /smith:install

Runs the user-scope installer. Idempotent.

## Steps

1. Run via Bash:
   ```
   pwsh -NoProfile -File C:/AiAppDeployments/AgentSmith/scripts/install-user-scope.ps1 $ARGUMENTS
   ```
2. Surface the script's output to the user verbatim. The final `[smith] installed. …` line is the success marker.
3. If the script throws a collision error, remind the user they can re-run with `--force` to overwrite, then stop.

## What it does

- Builds `daemon/dist/index.js` if missing
- Registers `agentsmith` MCP server at user scope
- Symlinks (or copies) `.claude/{agents,skills,commands/smith}` into `~/.claude/`
- Merges hooks + adds `mcp__agentsmith__*` permission into `~/.claude/settings.json`
- Writes manifest at `~/.claude/.agentsmith-installed.json`

After install, restart Claude Code in any project to surface `/smith:*` commands and `mcp__agentsmith__*` tools.
