---
description: One-shot install — register the agentsmith MCP server and (optionally) link the .claude/ surface into a target project.
argument-hint: "[--mcp-only|--link-project=<root>]"
model: sonnet
---

# /smith:bootstrap

> "I have to tell you a secret. I want out of here." — Smith

Idempotent bootstrap. Safe to re-run.

## Steps

1. Probe whether the agentsmith MCP server is already registered (`claude mcp list`). If not, instruct the user to run (all options before the server name, then `--`; `--env` pins the repo root so the daemon resolves paths regardless of where it self-locates):
   ```
   claude mcp add --scope user --env AGENTSMITH_REPO=<repo-root> agentsmith -- node <repo-root>/daemon/dist/index.js
   ```
   (We do not run this for them — MCP add prompts the user and is an authorization event.)

2. If `--link-project=<root>` is supplied, propose copying the four most useful Smith agents (smith-inspector, smith-archivist, sentinel-watcher, keymaker-router) into the target project's `.claude/agents/` and the `matrix-invariants` + `cross-project-conventions` skills into `.claude/skills/`. **Do not write** without explicit user confirmation in the next turn — surface the proposed file list first.

3. Verify the daemon build artifact exists (`<repo-root>/daemon/dist/index.js`). If absent, instruct the user:
   ```
   cd <repo-root>/daemon
   npm install && npm run build
   ```

4. Verify the Smith constitution is loadable (read `daemon/src/constitution/smith-constitution.md`, count `## N\d+` headings, confirm 10).

5. Call `mcp__agentsmith__inspector_invariants_list` if MCP is up; render the constitution sha256 plus invariant count as the final "ready" line.

## HITL gates

- Linking project files always asks for user confirmation; never auto-writes.

## Output format

```
[smith.bootstrap]
  mcp: registered | needs_install
  daemon_dist: present | missing
  constitution: 10 invariants, sha256=<hash>
  link_project: <root|skipped>
  next: <one-line suggestion>
```
