# daemon/src — Module Layout

> *"Never send a human to do a machine's job."*

The AgentSmith daemon is a single MCP server (`index.ts`) that wires a four-pillar kernel — **Factory, Inspector, Sentinel, Archivist** — and a set of bridge clients into the sibling daemons. This page maps the source tree to those pillars. For the runtime behavior see [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md); for the tool surface see [`../../docs/TOOLS.md`](../../docs/TOOLS.md).

## Entry + wiring

| Path | Role |
|------|------|
| `index.ts` | MCP server entry point. Loads config, seals the constitution hash, constructs the kernel, **attests N8 at boot** (real tools vs. `buildN8RefusalTools`), starts the stdio transport, then the Hydra/Eights telemetry tails. |
| `config.ts` | Paths, quotas, defaults (`agentsmithHome`, spool/log dirs, N5 cap). |
| `logger.ts` | Structured logger factory. |
| `mcp/` | MCP transport + tool registration. `server.ts` (stdio server, `ToolMap`/`ToolDefinition`), `tools.ts` (`registerTools()` — the 29 tools + the `AS-GV` gates + `buildN8RefusalTools`), `zod-to-json.ts` (schema converter). |

## The four pillars

| Path | Pillar | Role |
|------|--------|------|
| `factory/` | **Factory** | Artifact generation. `generator.ts`, `best-of-n.ts`, `validators.ts`, and `templates/` — per-project template registries (`hydra`, `eights`, `executiveSuite`, `marketBliss`, `pairProgrammer`, `rlmCreative`, `agentSmith`, `_generic`) selected in `templates/index.ts`. |
| `inspector/` | **Inspector** | Schema + invariant + policy validation, fail-closed. `index.ts` (orchestrator), `schema-checks.ts` (per-(project,kind) schema gate — **N7 escalates when unregistered**), `invariants.ts`, `policy-cross-check.ts`, `verdict.ts`, and `schemas/` (per-project Zod artifact schemas). |
| `sentinel/` | **Sentinel** | Anomaly detection + bounded replication. `watcher.ts` (ring buffer), `classifier.ts`, `signatures.ts`, `drift.ts`, `replication-controller.ts` (N5 cap), and the telemetry tails `hydra-tail.ts` / `eights-tail.ts` (`tail.ts` shared). |
| `archivist/` | **Archivist** | Append-only ledger + audit. `decision-store.ts` (seal/list), `trace.ts` (cross-system audit stitching), `index.ts`. |

## Supporting subsystems

| Path | Role |
|------|------|
| `quarantine/` | Isolation + HITL ticketing (`isolator.ts`). Releases require TheEights HITL (N10). |
| `keymaker/` | Cross-project registry walker. `registry.ts` (scan/cache), `gap-analyzer.ts` (`analyzeGaps`). |
| `oracle/` | Rubric-based evaluation. `eval-runner.ts`, `rubric-loader.ts`, `promotion.ts` (degraded gate → `hitl_pending`). |
| `bridges/` | Real MCP clients into siblings. `eights-bridge.ts` (memory/evolution/attest + the sink-side `_runSinkGate` + spool replay), `hydra-bridge.ts` (squad list + venom cross-check), `pp-bridge.ts` (best-of-N + Borda), `consumer-bridge.ts`, `mcp-client.ts` (transport). |
| `constitution/` | **FROZEN.** `smith-constitution.md` — the N1..N10 invariants. Hash-bound; never edited by agents. |
| `schemas/` | Shared Zod schemas: `artifact.ts`, `anomaly.ts`, `verdict.ts`, `decision-record.ts`, `invariant.ts`, `meta-proposal.ts`, `replication.ts`. |

## Governance gate locations

The fail-closed `AS-GV-1..8` enforcement (see [ARCHITECTURE.md §9](../../ARCHITECTURE.md#9-governance-enforcement-as-gv-18)) is spread across:

- `mcp/tools.ts` — Inspector-first then venom-guard ordering in `factory.promote` / `eights.evolution_propose`; `buildN8RefusalTools`.
- `index.ts` — strict N8 boot attestation (exact `content_hash`, no caller override).
- `bridges/eights-bridge.ts` — sink-side `_runSinkGate` (N8 TOCTOU → Inspector → N2), spool replay re-gating.
- `bridges/hydra-bridge.ts` — `venomCrossCheck` strict `r.ok === true`.
- `inspector/schema-checks.ts` — N7 fail-closed for unregistered `(project, kind)`.
