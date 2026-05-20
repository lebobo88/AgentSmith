---
description: Cross-project registry walker — scan or surface missing artifacts.
argument-hint: "[--scan|--gap-report] [--project=<key>]"
model: haiku
---

# /smith:keymaker

Dispatches **keymaker-router**.

## Steps

1. Parse the flag and optional `--project`.
2. `--scan`: call `mcp__agentsmith__keymaker_scan`. Returns a registry snapshot and refreshes the cache.
3. `--gap-report` (default): call `mcp__agentsmith__keymaker_gap_report`. Returns missing artifacts and suggested `/smith:scaffold` commands.

## Output format

```
[smith.keymaker] scope=<project|all> entries=<n>
[smith.keymaker] gaps:
  - <project>:<kind>:<slug> -> /smith:scaffold <kind> <slug> --project=<project>
```
