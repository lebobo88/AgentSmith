# AgentSmith — MCP Tools

> *"Never send a human to do a machine's job."*

AgentSmith exposes **29 MCP tools** under the `agentsmith.*` namespace. This page enumerates every tool grouped by pillar / sub-namespace.

**Source of truth:** [`daemon/src/mcp/tools.ts`](../daemon/src/mcp/tools.ts) — `registerTools()`. If a tool is added or renamed there, update this page and [`mesh-manifest.yaml`](../mesh-manifest.yaml).

In mesh mode (fronted by `hydra_gateway`) these surface as `mcp__hydra_gateway__agentsmith__<tool_with_underscores>`; in standalone mode as `mcp__agentsmith__<tool>`.

> **Boot caveat (N8):** when constitution attestation fails, the MCP server still answers `initialize` but **every tool below returns an N8 refusal envelope** (`buildN8RefusalTools` wraps the real tool set). See [ARCHITECTURE.md §9.2](../ARCHITECTURE.md#92-strict-n8-boot-attestation).

---

## Factory pillar — `agentsmith.factory.*`

Generate and promote governance artifacts. Factory does **not** write user-facing product features.

| Tool | Description |
|------|-------------|
| `agentsmith.factory.scaffold` | Scaffold a candidate artifact (`agent`/`skill`/`command`/`hook`/`team`/`squad`/`rubric`/`mcp`) from per-project templates. |
| `agentsmith.factory.promote` | Promote a passing draft via TheEights `evolution.propose` (auto-commit if low-risk). **Inspector gate runs first (must `allow`); N2 venom guard runs second (unreachable fails closed)** before any oracle call. |

## Inspector pillar — `agentsmith.inspector.*`

Schema + invariant + policy validation, fail-closed.

| Tool | Description |
|------|-------------|
| `agentsmith.inspector.inspect` | Run schema + invariant + policy validators on an artifact draft or path content. |
| `agentsmith.inspector.invariants_list` | List the active Smith invariants (frozen, hash-bound) with `constitution_sha256`. Used as the mesh `healthProbe`. |

## Constitution — `agentsmith.constitution.*`

| Tool | Description |
|------|-------------|
| `agentsmith.constitution.get` | Get the active Smith constitution snapshot (sha256 + invariants). |
| `agentsmith.constitution.attest` | Emit an attestation receipt binding a workflow to a consumer's constitution hash (default consumer `hydra`). The hash is sourced internally — **no caller override**. |
| `agentsmith.constitution.propose_amendment` | Open a HITL ticket proposing an amendment to the Smith constitution (N1 — amendment only via TheEights + HITL). |

## Replicator (Sentinel) — `agentsmith.replicator.*`

Bounded self-replication, capped at 4 clones per scope (N5).

| Tool | Description |
|------|-------------|
| `agentsmith.replicator.spawn` | Spawn a Smith watcher clone for a given scope (N5: quota-bounded). |
| `agentsmith.replicator.teardown` | Tear down an active Smith watcher clone. |
| `agentsmith.replicator.list` | List active Smith clones. |

## Sentinel pillar — `agentsmith.sentinel.*`

Anomaly detection on the telemetry tail.

| Tool | Description |
|------|-------------|
| `agentsmith.sentinel.signatures_list` | List the loaded Smith anomaly signature library. |
| `agentsmith.sentinel.events_recent` | Return the most recent anomaly events from the watcher ring buffer. |
| `agentsmith.sentinel.classify` | Classify an anomaly event against the loaded signature library. |

## Quarantine — `agentsmith.quarantine.*`

| Tool | Description |
|------|-------------|
| `agentsmith.quarantine.isolate` | Isolate an entity (`agent`/`skill`/`artifact`/`memory`) and open a HITL release ticket (N10). |
| `agentsmith.quarantine.release` | Release or purge a quarantined entity after a HITL decision. |

## Keymaker — `agentsmith.keymaker.*`

Cross-project registry walker.

| Tool | Description |
|------|-------------|
| `agentsmith.keymaker.scan` | Scan one or all consumer projects for installed agents/skills/commands/hooks/teams/squads/rubrics (writes cache). |
| `agentsmith.keymaker.gap_report` | Surface missing artifacts per project profile. |

## Oracle — `agentsmith.oracle.*`

| Tool | Description |
|------|-------------|
| `agentsmith.oracle.evaluate` | Evaluate a candidate artifact against named Smith rubrics (see [RUBRICS.md](./RUBRICS.md)). |

## Archivist pillar — `agentsmith.archivist.*`

Append-only decision ledger + cross-system audit.

| Tool | Description |
|------|-------------|
| `agentsmith.archivist.audit` | Generate a cross-system audit report from Smith decisions plus linked traces. |
| `agentsmith.archivist.decisions` | List Smith decision records with optional filters. Declared as the mesh `audit.exportTool`. |
| `agentsmith.archivist.seal` | Seal a new `SmithDecisionRecord` into the append-only ledger (N6). |

---

## Bridge proxy tools (Phase 2 — real MCP clients into siblings)

These proxy into peer daemons through the bridge layer (`daemon/src/bridges/`).

### TheEights — `agentsmith.eights.*`

| Tool | Description |
|------|-------------|
| `agentsmith.eights.memory_add` | Add a memory item to TheEights' memory store (`eights.memory.add`). |
| `agentsmith.eights.evolution_propose` | Propose an evolution of a resource via TheEights. **Inspector gate (must `allow`) and N2 venom guard run before proposing**; a non-allow verdict or blocked venom gate rejects without calling TheEights. |
| `agentsmith.eights.hitl_request` | Open a HITL request via TheEights governance (`eights.governance.hitl.request`). |
| `agentsmith.eights.lookup_envelope_attempt` | Look up an envelope/attempt id in TheEights' shared ledger before declaring it "not found" (`{found, via_kinds}`). |

### Hydra — `agentsmith.hydra.*`

| Tool | Description |
|------|-------------|
| `agentsmith.hydra.squad_list` | List Hydra squads via the Hydra bridge (`hydra.squad.list`). |
| `agentsmith.hydra.venom_cross_check` | Ask Hydra's Venom to cross-check a capability invocation (the N2 venom guard). |

### pair-programmer — `agentsmith.pp.*`

| Tool | Description |
|------|-------------|
| `agentsmith.pp.best_of_start` | Start a pair-programmer best-of-N stage (`start_best_of_stage`). |
| `agentsmith.pp.borda_count` | Run Borda-count winner selection over candidates (`borda_count`). |

---

**Total: 29 tools** — 2 factory, 2 inspector, 3 constitution, 3 replicator, 3 sentinel, 2 quarantine, 2 keymaker, 1 oracle, 3 archivist, 4 eights-bridge, 2 hydra-bridge, 2 pp-bridge.
