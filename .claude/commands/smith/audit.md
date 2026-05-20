---
description: Produce a cross-system audit report stitching Smith decisions to Hydra and TheEights traces.
argument-hint: "<trace_id|workflow_id>"
model: sonnet
---

# /smith:audit

Dispatches **smith-archivist**.

## Steps

1. Parse the identifier and pass as `workflow_id` or `trace_id` depending on prefix (`wf_*`, `trc_*`).
2. Call `mcp__agentsmith__archivist_audit`.
3. Render decisions in chronological order with linked cross-system references.

## Output format

```
[smith.archivist] audit for <id> — <n> decisions
  <ts> actor=<a> subject=<k>:<id> outcome=<o> rationale=<r>
```
