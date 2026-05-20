---
description: Reconstruct a single Smith decision with its full evidence chain.
argument-hint: "<decision_id>"
model: sonnet
---

# /smith:replay

Dispatches **smith-archivist**.

## Steps

1. Parse `<decision_id>`.
2. Call `mcp__agentsmith__archivist_decisions` filtered by id.
3. Render verdict, subject, cited invariants, parent decision (if any), and audit links.
4. Re-run `mcp__agentsmith__inspector_inspect` against the subject if the original verdict was a deny — surface any divergence as evidence of drift.

## Output format

```
[smith.replay] decision <id> sealed <ts>
  subject: <kind>:<id>
  verdict: <outcome> — <rationale>
  cited: N..., N...
  audit_links: ...
```
