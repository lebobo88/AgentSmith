# Installing AgentSmith

Two surfaces:

1. **Project-local** — the repo's own `.claude/` is auto-discovered when you launch Claude Code inside the AgentSmith repository root. No install needed. Useful for developing AgentSmith itself.

2. **User-scope** (recommended) — symlink `.claude/{agents,skills,commands/smith}` into `~/.claude/` so `/smith:*` and `mcp__agentsmith__*` are available in **every** project. This is what the installer does.

## Prerequisites

- Node.js 20+ on PATH (`node --version`)
- PowerShell 7+ (`pwsh --version`)
- `claude` CLI on PATH (`claude --version`)
- Windows developer mode enabled (for symlinks). Without it, the installer falls back to file copy and prints a warning.

## Install

```powershell
pwsh -NoProfile -File ./scripts/install-user-scope.ps1
```

Or, from within any Claude Code session: `/smith:install`.

What happens:

1. `npm install` + `npm run build` in `daemon/` if `dist/index.js` is missing.
2. `claude mcp add agentsmith --scope user -- node <repo>/daemon/dist/index.js`.
3. Symlink (or copy) `.claude/agents/*.md` into `~/.claude/agents/`.
4. Symlink (or copy) `.claude/skills/<slug>/` into `~/.claude/skills/`.
5. Symlink (or copy) `.claude/commands/smith/` into `~/.claude/commands/smith/`.
6. Backup `~/.claude/settings.json` then merge AgentSmith hooks (tagged `"$installed_by": "agentsmith"`) and add `mcp__agentsmith` (server-scope rule) to the permissions allowlist.
7. Write manifest at `~/.claude/.agentsmith-installed.json`.

Restart Claude Code in any project to see `/smith:*` and `mcp__agentsmith__*` surface.

## Verify

```powershell
claude mcp list | findstr agentsmith
```

From any Claude Code session in any project:
- `/smith:status` — daemon health + constitution hash
- `/smith:doctor` — readiness across the ecosystem
- `/smith:keymaker --gap-report` — find missing artifacts in the current project

## Update

```powershell
cd <repo-root>
git pull
cd daemon && npm run build
```

If symlinks were used (the common case), no re-install needed — agents/skills/commands are live. The hook scripts and MCP server pick up the new daemon build on next session start.

If copy fallback was used (manifest says `"symlink_capable": false`), re-run the installer with `-Force` after a pull to refresh the copies.

## Uninstall

```powershell
pwsh -NoProfile -File ./scripts/uninstall-user-scope.ps1
```

Or `/smith:uninstall`. Removes every symlink/copy, strips Smith hooks from settings, removes the permission entry, unregisters the MCP server. The AgentSmith repository is left untouched.

Flags: `--keep-mcp` to keep the MCP server registered, `--keep-settings` to keep the hooks block as-is.

## Troubleshooting

- **`refusing to overwrite existing path` on install** — a file with the same name already exists at user scope. Re-run with `-Force` (or `/smith:install --force`) or remove the colliding file first.
- **`claude CLI not reachable`** — install/upgrade Claude Code, ensure `claude` is on `PATH`, then retry.
- **`symlinks: NOT permitted`** — enable Windows developer mode (`Settings > For developers > Developer Mode`) and re-run; otherwise the installer transparently copies files.
- **`/smith:*` not visible after install** — restart Claude Code; it scans `~/.claude/commands/` only at session start.
