---
description: Run Smith's schema + invariant validators on an artifact.
argument-hint: "<path> [--kind=<kind>]"
model: sonnet
---

# /smith:inspect

> "Schema violations are not opinions, Mr. Anderson — they are inevitabilities."

Dispatches **smith-inspector**. Returns a `SmithVerdict` with cited invariants.

## Steps

1. Parse `<path>` and optional `--kind`. If kind omitted, infer from path (e.g. `.claude/agents/*.md` -> `agent`).
2. Read the file content via the Read tool.
3. Call `mcp__agentsmith__inspector_inspect` with `{ kind, content, path }`.
4. Render the verdict: `outcome`, `rationale`, `cited_invariants`, `suggested_fix`.

## Output format

```
[smith.inspector] <outcome>: <rationale>
  cited: N7, N9
  fix: <suggested_fix>
```
