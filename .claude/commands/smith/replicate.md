---
description: Spawn or tear down Smith watcher clones (quota-bounded per N5).
argument-hint: "<scope> [--reason=<why>] [--teardown=<clone_id>]"
model: sonnet
---

# /smith:replicate

Dispatches **smith-replicator**.

## Steps

1. Parse `<scope>` and the optional `--reason` or `--teardown` flag.
2. If `--teardown=<clone_id>` is present, call `mcp__agentsmith__replicator_teardown` and return.
3. Otherwise call `mcp__agentsmith__replicator_spawn` with `{ scope, reason }`. On quota breach (N5) the daemon will return an error — surface it verbatim.
4. Call `mcp__agentsmith__replicator_list` and render the active clone roster.

## Output format

```
[smith.replicator] spawned <clone_id> for scope=<scope> reason=<reason>
[smith.replicator] active: <n>/<max>
```
