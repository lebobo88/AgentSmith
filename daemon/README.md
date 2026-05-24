# agentsmith-daemon

TypeScript MCP server that hosts the AgentSmith kernel: Factory + Inspector + Sentinel + Archivist.

## Build

```powershell
cd daemon
npm install
npm run build
```

## Register as MCP server (user scope)

```powershell
claude mcp add agentsmith --scope user -- node ./dist/index.js
```

## Phase 0 surface

Tools exposed under `agentsmith.*`:

- `factory.scaffold`, `factory.promote`
- `inspector.inspect`, `inspector.invariants_list`
- `constitution.get`, `constitution.attest`, `constitution.propose_amendment`
- `replicator.spawn`, `replicator.teardown`, `replicator.list`
- `sentinel.classify`
- `quarantine.isolate`, `quarantine.release`
- `keymaker.scan`, `keymaker.gap_report`
- `oracle.evaluate`
- `archivist.audit`, `archivist.decisions`, `archivist.seal`

Phase 1 swaps stubs for real cross-vendor best-of-N via pp_harness, TheEights
evolution.propose, and Hydra venom cross-check.
