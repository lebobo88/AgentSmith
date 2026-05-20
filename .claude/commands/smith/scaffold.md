---
description: Factory entry point — scaffold a new agent, skill, command, hook, team, squad, rubric, or mcp config.
argument-hint: "<kind> <slug> [--project=<root>]"
model: sonnet
---

# /smith:scaffold

> "Never send a human to do a machine's job." — Smith

Dispatches **smith-architect**. Generates a structurally-valid candidate artifact, validates it through smith-inspector, and queues it for evolution review.

## Steps

1. Parse `$ARGUMENTS` for `<kind>` (agent|skill|command|hook|team|squad|rubric|mcp), `<slug>` (kebab-case), and optional `--project=<consumer_key>` (defaults to the active project's key).
2. Dispatch the **smith-architect** agent with the parsed parameters.
3. Call `mcp__agentsmith__factory_scaffold` to materialize a draft.
4. Call `mcp__agentsmith__inspector_inspect` on the draft body. If the verdict is `deny`, halt and surface the cited invariants — do not promote.
5. If allowed, call `mcp__agentsmith__factory_promote` to open an evolution proposal in TheEights.
6. Render the draft `target_path` and the resulting `eights_proposal_id` (or HITL ticket id) to the user.

## HITL gates

- Inspector deny → halt.
- Risk-class medium/high/critical → evolution lands in TheEights HITL queue.

## Output format

```
[smith.factory] draft <draft_id> for <kind>:<slug> -> <target_path>
[smith.inspector] <outcome>: <rationale>
[smith.evolution] proposal <id> status=<auto_committed|hitl_pending>
```
