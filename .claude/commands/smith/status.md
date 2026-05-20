---
description: Daemon pulse-check — health, constitution hash, active clones, open quarantines.
model: haiku
---

# /smith:status

## Steps

1. Call `mcp__agentsmith__inspector_invariants_list` as a health probe (also returns `constitution_sha256`).
2. Call `mcp__agentsmith__replicator_list` for active clone count.
3. Render a compact one-screen summary.

## Output format

```
[smith.status]
  daemon: online
  constitution_sha256: <hash>
  invariants: <n>
  clones_active: <n>
  open_quarantines: <n>
  pending_hitl: <n>
```
