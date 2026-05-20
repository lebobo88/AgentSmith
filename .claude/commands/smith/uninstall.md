---
description: Uninstall AgentSmith from Claude Code user scope (reverses /smith:install via the manifest).
argument-hint: "[--keep-mcp] [--keep-settings]"
model: sonnet
---

# /smith:uninstall

## Steps

1. Run via Bash:
   ```
   pwsh -NoProfile -File C:/AiAppDeployments/AgentSmith/scripts/uninstall-user-scope.ps1 $ARGUMENTS
   ```
2. Surface output verbatim. Final `[smith] uninstalled. …` line is the success marker.

## What it does

- Reads `~/.claude/.agentsmith-installed.json` manifest
- Removes every symlinked/copied agent, skill, and the `commands/smith` directory
- Strips Smith-tagged hook entries (`$installed_by = "agentsmith"`) from `~/.claude/settings.json`
- Removes the `mcp__agentsmith__*` permission entry
- Calls `claude mcp remove agentsmith --scope user`
- Deletes the manifest

Flags: `--keep-mcp` to skip MCP unregister; `--keep-settings` to skip settings.json edit.
