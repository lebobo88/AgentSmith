---
description: Deep readiness check across the agent ecosystem (sibling MCP servers, project roots, constitution attestation).
model: haiku
---

# /smith:doctor

Probes:

1. `mcp__agentsmith__inspector_invariants_list` — daemon up + constitution loaded
2. Each sibling project root exists (Hydra, TheEights, ExecutiveSuite, MarketBliss, RLM-Creative, pair-programmer)
3. TheEights MCP reachable (best-effort, via bridge)
4. Hydra MCP reachable (best-effort, via bridge)
5. pp_harness MCP reachable (best-effort, via bridge)

## Steps

1. Call `mcp__agentsmith__inspector_invariants_list`. On error, report `daemon: down`.
2. Glob each sibling root; report present/missing per project.
3. (Phase 2+) Call `mcp__agentsmith__eights_evolution_propose` with `dry_run=true` to probe the bridge. Same for hydra and pp bridges.
4. Render a one-screen matrix with green/yellow/red status per row.

## Output format

```
[smith.doctor]
  daemon:           ok (sha256=<hash>)
  hydra-root:       ok | missing
  eights-root:      ok | missing
  executive-root:   ok | missing
  marketbliss-root: ok | missing
  rlm-root:         ok | missing
  pp-root:          ok | missing
  hydra-mcp:        ok | degraded
  eights-mcp:       ok | degraded
  pp-mcp:           ok | degraded
```
