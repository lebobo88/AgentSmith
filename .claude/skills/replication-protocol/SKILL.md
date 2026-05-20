---
name: replication-protocol
description: When and how AgentSmith spawns replicator clones, the per-scope quota of 4, trigger conditions, and teardown rules. Read before any /smith:replicate invocation.
allowed-tools: Read, Bash
---

# Replication Protocol

> "Me. Me. Me. Me." — but with quotas, scopes, and an audit trail.

Smith replication is bounded by **N9 (replication_quota)**. Every clone is scoped, observed, and reaped. There is no such thing as an un-scoped Smith.

## Quota

| Scope kind        | Default cap | Override path                              |
| ----------------- | ----------- | ------------------------------------------ |
| `workflow:<id>`   | 4           | HITL via `eights.governance.hitl.request`  |
| `squad:<name>`    | 4           | HITL                                       |
| `project:<slug>`  | 4           | HITL + risk_class >= medium evaluation     |
| `global`          | 0           | Forbidden. Must decompose into sub-scopes. |

Total in-flight clones across all scopes are capped by daemon config `smith.replication.global_ceiling` (default 16).

## Triggers (when Smith SHOULD self-replicate)

1. **Hot squad detected** — a squad emits >3 dispatches/min for >2 consecutive minutes. Spawn one observer clone scoped to that squad.
2. **High-risk envelope** — a `HITLRequest` with `policy_breach=true` OR a `DecisionRecord` with `risk_class in {high, critical}`. Spawn one auditor clone scoped to the workflow.
3. **Known anomaly signature match** — see `anomaly-signatures`. Spawn one investigator clone scoped to the affected resource.
4. **Manual** — `/smith:replicate --scope <s> --role <observer|auditor|investigator>`.

Triggers 1-3 are auto-issued by the daemon's watcher loop. Trigger 4 is operator-initiated and still subject to the quota.

## Roles

| Role          | Read | Write          | Refuse rights | Notes                                       |
| ------------- | ---- | -------------- | ------------- | ------------------------------------------- |
| observer      | yes  | audit log only | no            | Lowest privilege. Default for hot-squad.    |
| auditor       | yes  | audit + verdict| advisory      | Can record `verdict=concern` on artifacts.  |
| investigator  | yes  | audit + quarantine_propose | yes (per N3) | May propose quarantine; cannot execute. |

Promotion across roles requires teardown + respawn. No in-place privilege escalation (N6).

## Teardown

A clone is reaped when ANY of:

- Scope idle >5 minutes (no envelopes observed)
- Quota reduced below current count (oldest-first eviction)
- Workflow/squad reaches terminal state
- Manual `/smith:replicate --teardown --scope <s>` or `--clone <id>`
- Daemon restart (clones do not survive cold start; N1)

Every teardown emits an audit line per N5.

## Diagram

```
                        +-------------------+
                        |  Smith (primary)  |
                        |  hash-verified    |
                        +---------+---------+
                                  |
              auto-trigger / manual replicate request
                                  |
              +-------------------+-------------------+
              |                   |                   |
     +--------v-------+  +--------v-------+  +--------v-------+
     | clone:observer |  | clone:auditor  |  | clone:invest.  |
     | scope=squad:X  |  | scope=wf:Y     |  | scope=res:Z    |
     | quota 1/4      |  | quota 1/4      |  | quota 1/4      |
     +--------+-------+  +--------+-------+  +--------+-------+
              |                   |                   |
              +---------> audit stream <--------------+
                                  |
                            (N5 immutable)
```

## Failure modes

- **Quota breach attempt** — emits `replication-quota-breach` anomaly; spawn refused per N9.
- **Scope ambiguity** — if scope cannot be uniquely resolved, refuse; do not guess.
- **Hash mismatch on spawn** — refuse per N1; raise `constitution-hash-mismatch`.

## Related skills

- `matrix-invariants` (N9, N1, N5, N6)
- `anomaly-signatures` (which signatures trigger which roles)
- `quarantine-protocol` (investigator output path)
