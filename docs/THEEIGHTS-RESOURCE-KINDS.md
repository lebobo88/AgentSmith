# TheEights Resource-Kind Extension Manifest

AgentSmith extends TheEights' resource model with four new `kind` values so the meta-layer is itself memoizable, governable, and evolvable through the same Autogenesis pipeline that governs every other consumer's artifacts.

This manifest is what AgentSmith's bridge registers with TheEights at startup. It mirrors the schema at `C:/AiAppDeployments/TheEights/daemon/src/schemas/resource.ts` and is intended to land upstream as a PR; until then, AgentSmith registers them as `kind: "policy"` with a tag-based discriminator.

## New `kind` values

| Kind | Default `risk_class` | Default `evolution_policy` | Description |
|------|----------------------|----------------------------|-------------|
| `smith_invariant`            | critical | frozen        | An N-numbered Smith constitution invariant. Frozen by default; amendable only via the constitution amendment procedure (HITL + explicit operator approval). Backed by `C:/AiAppDeployments/AgentSmith/daemon/src/constitution/smith-constitution.md`. |
| `smith_template`             | medium   | hitl-only     | An artifact template the Factory consults when scaffolding (per-project, per-kind). Mutations land in the HITL queue. |
| `smith_anomaly_signature`    | low      | auto          | A Sentinel signature (id, pattern, severity, related_invariant, mitigation). Auto-commit on miner-promoted improvements; never auto-deletes. |
| `smith_replication_quota`    | high     | hitl-only     | A scope cap on watcher clones (default 4 per scope). Raising the cap requires HITL approval and an evolution commit (per N5). |

## Registration sequence

On AgentSmith daemon startup:

1. Probe TheEights via `eights-bridge.available()`. If unreachable, log degraded and skip registration.
2. For each kind above, call `eights.evolution.list_pending` to check existing registrations.
3. If missing, call `eights.evolution.propose` with:
   - `rid: resource:agentsmith.kind.<kind>`
   - `candidate_content`: JSON describing the kind schema (criteria fields, defaults)
   - `justification`: "AgentSmith meta-layer bootstrap"
   - `risk_class`: matches table above
4. Subsequent reads/writes for these kinds flow through `eights.evolution.*` exactly like any other resource.

## Risk-class semantics (mirrored from TheEights schema)

- `low` → `auto`: auto-commit on miner promotion or successful propose+evaluate.
- `medium` / `high` → `hitl-only`: lands in HITL queue regardless of evaluation outcome.
- `critical` → `frozen`: cannot be mutated through `evolution.propose`; only through the explicit constitution amendment procedure.

## Cross-references

- Smith constitution: `C:/AiAppDeployments/AgentSmith/daemon/src/constitution/smith-constitution.md`
- TheEights evolution engine: `C:/AiAppDeployments/TheEights/daemon/src/engines/evolution.ts`
- TheEights resource schema: `C:/AiAppDeployments/TheEights/daemon/src/schemas/resource.ts`
- Skill: `C:/AiAppDeployments/AgentSmith/.claude/skills/evolution-handoff/SKILL.md`
