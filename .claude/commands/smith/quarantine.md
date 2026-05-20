---
description: Isolate a rogue artifact, agent, or memory and open a HITL release ticket.
argument-hint: "<entity_id> [--reason=<why>]"
model: sonnet
---

# /smith:quarantine

Dispatches **smith-quarantine**. Always opens a HITL ticket (N3, N10).

## Steps

1. Parse `<entity_id>` and `--reason`.
2. Call `mcp__agentsmith__quarantine_isolate` with `{ entity_id, reason }`. The daemon will simultaneously file the HITL ticket via TheEights.
3. Render the `ticket_id` and the linked `hitl_ticket_id`. Remind the user that release requires `/smith:quarantine --release=<ticket_id>` after HITL approval.

## Output format

```
[smith.quarantine] ticket <id> opened for entity=<entity_id>
[smith.quarantine] HITL request <hitl_id> pending operator decision
```
