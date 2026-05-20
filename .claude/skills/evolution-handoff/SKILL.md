---
name: evolution-handoff
description: The propose/evaluate/commit/HITL contract with TheEights for evolving artifacts. Maps risk_class to evolution policy and documents the API surface AgentSmith calls.
allowed-tools: Read, Bash
---

# Evolution Handoff (AgentSmith <-> TheEights)

Smith never edits the world in place. Smith **proposes**; TheEights **evolves**; humans **approve** when risk_class demands it.

## Risk class -> evolution policy

| risk_class | Policy        | Path                                                            |
| ---------- | ------------- | --------------------------------------------------------------- |
| low        | auto          | propose -> evaluate -> commit (no HITL; full audit per N5)      |
| medium     | hitl-only     | propose -> evaluate -> HITL approve -> commit                   |
| high       | hitl-only     | propose -> evaluate -> HITL approve -> commit (2-reviewer rule) |
| critical   | frozen        | propose -> evaluate -> immortal-head HITL -> commit OR refuse   |

`frozen` does not mean uneditable; it means the change requires the immortal-head review path documented in `cerberus-bridge`. Items in the `quarantine-protocol` "what NOT to quarantine" list are **constitution-frozen** and reject even `propose` calls (refuse per N4).

## API surface (TheEights MCP / daemon endpoints)

All calls go through the `eights.evolution.*` namespace. Smith authenticates with its constitution hash; mismatches refuse per N1.

### `eights.evolution.propose`
Submit a candidate change.

```yaml
inputs:
  artifact_kind: <agent|skill|command|hook|team|squad|rubric|mcp>
  resource_id: <stable id or path>
  diff: <unified diff or full replacement bytes>
  rationale: <free text; cites a signal, anomaly, or request>
  proposed_risk_class: <low|medium|high|critical>
returns:
  proposal_id: <id>
  status: registered
```

### `eights.evolution.evaluate`
Trigger evaluation (sandbox build, validator suite, judge rubric).

```yaml
inputs:
  proposal_id: <id>
returns:
  verdict: <pass|fail|concern>
  scores: { rubric: <slug>, breakdown: {...} }
  effective_risk_class: <low|medium|high|critical>   # may upgrade
  blockers: [<anomaly-signature>, ...]
```

`effective_risk_class` may upgrade `proposed_risk_class`. Downgrades are refused per N4.

### `eights.evolution.commit`
Apply an evaluated proposal.

```yaml
inputs:
  proposal_id: <id>
  approval_token: <required when effective_risk_class >= medium>
returns:
  commit_id: <id>
  applied_at: <iso>
  rollback_token: <opaque>
```

Refuses if `verdict != pass`. Refuses if effective_risk_class requires approval and `approval_token` is missing.

### `eights.evolution.approve`
Human path — usually invoked by a HITL reviewer UI, but Smith may surface the deeplink.

```yaml
inputs:
  proposal_id: <id>
  reviewer: <human id>
  decision: <approve|reject>
  notes: <text>
returns:
  approval_token: <id>      # only on approve
```

### `eights.evolution.rollback`
Undo a commit. Always available; never gated.

```yaml
inputs:
  commit_id: <id>
  rollback_token: <opaque>
  reason: <text>
returns:
  reverted_at: <iso>
```

A rollback emits a fresh audit record and does NOT delete the original commit history (N5).

## When AgentSmith uses each

| Trigger                                                       | Call sequence                              |
| ------------------------------------------------------------- | ------------------------------------------ |
| Detector suggests a low-risk fix (typo, missing description)  | propose -> evaluate -> commit              |
| Operator requests new skill via `/smith:factory`              | propose -> evaluate -> (HITL if med+) -> commit |
| Anomaly mitigation requires schema correction                 | propose -> evaluate -> HITL -> commit      |
| Constitution-adjacent request                                 | refuse per N4; suggest immortal-head path  |
| Post-deploy regression detected by missability check          | rollback (with reason citing detection)    |

## Failure modes

- **Evaluator timeout** (>120s) — proposal stays in `registered`; Smith does NOT auto-retry; surfaces to operator.
- **Validator suite unavailable** — refuse `commit`; do not bypass. Validators are part of the trust boundary.
- **Approval token reused** — refuse; tokens are single-use, scoped to one proposal_id.
- **Hash skew** between Smith and TheEights constitution mirrors — both halt; immortal-head HITL.
- **Race between propose and quarantine** — quarantine wins; the proposal is auto-cancelled and reasoned in audit.

## Related skills

- `matrix-invariants` (N1, N4, N5, N6 cited above)
- `agent-factory-recipes` (default risk_class per kind)
- `quarantine-protocol` (the frozen-resource list)
- `cerberus-bridge` (immortal-head path for critical)
