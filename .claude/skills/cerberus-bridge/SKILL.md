---
name: cerberus-bridge
description: Refusal-appeal protocol between AgentSmith and Hydra's venom gate. How to file false-positive or false-negative appeals, immortal-head review path, and required audit trail.
allowed-tools: Read, Bash
---

# Cerberus Bridge (AgentSmith <-> Hydra venom gate)

Two independent guardians, three review heads, one audit tape. The venom gate refuses; Smith may **appeal**, never override (N10).

> Hydra's venom gate is the capability veto. Smith's invariants are the conduct veto. Where they disagree, a human decides.

## Appeal types

| Type                  | Smith's claim                          | Risk to challenge                         |
| --------------------- | -------------------------------------- | ----------------------------------------- |
| false-positive (FP)   | Venom refused a safe capability        | If granted in error: exfil / runaway tool |
| false-negative (FN)   | Venom allowed an unsafe capability     | If ignored: silent compromise             |
| scope-overreach (SO)  | Venom ruling applied beyond its scope  | Procedural drift                          |

## When Smith may file

- **FP**: ONLY after a detector or operator presents concrete evidence the refused capability is in normal use across >=2 sibling projects, OR a HITL reviewer requests reconsideration.
- **FN**: whenever ANY anomaly signature matches a venom-allowed capability path, or `venom-capability-shadow` fires.
- **SO**: when a venom ruling cites a scope (project, workflow, squad) that does not match the resource being refused.

## What Smith may NEVER do

- Mutate venom policy directly (refuse per N10).
- Re-issue the refused request through a clone (refuse per N2 + N10).
- Quarantine the venom gate or its policy files (refuse per N4; see `quarantine-protocol` guardrails).
- Approve its own appeal (the three-head review forbids self-review).

## Filing an appeal

Use the `hydra.venom.appeal.file` MCP endpoint. Envelope:

```yaml
appeal_kind: <FP|FN|SO>
venom_ruling_id: <id from the refusal audit line>
resource_kind: <agent|skill|command|hook|team|squad|rubric|mcp>
resource_id: <stable id or path>
evidence:
  - kind: <usage|signature_match|policy_diff|operator_note>
    payload: <content or pointer>
proposed_outcome: <reverse|narrow|uphold-with-note|escalate>
smith_clone_id: <if filed by a clone; else "primary">
filed_at: <iso>
```

Filing emits an audit line:

```
Appealed per N10: venom_ruling=<id> kind=<FP|FN|SO> proposed=<outcome>
```

## Immortal-head review path

Cerberus has three heads; venom appeals require **two of three** to act:

| Head        | Role in appeal                                          |
| ----------- | ------------------------------------------------------- |
| venom-head  | The original refuser; restates rationale; may concede.  |
| guard-head  | Hydra's policy-historian; checks precedent and scope.   |
| immortal-head | Human reviewer; required for FN and for any `critical` risk_class. |

Decision rules:

- **FP**: venom-head + guard-head may resolve (no human required) IF risk_class <= medium. Otherwise immortal-head is mandatory.
- **FN**: immortal-head is ALWAYS required. The capability is paused during review.
- **SO**: guard-head alone may resolve and emit a scope-correction note.

Decision is published via `hydra.venom.appeal.resolve`:

```yaml
outcome: <reversed|narrowed|upheld|escalated_to_constitution>
quorum: [<venom-head|guard-head|immortal-head>, ...]
notes: <text>
new_policy_version: <id or null>
resolved_at: <iso>
```

## Audit trail requirements (N5)

Every appeal MUST have, at minimum, the following linked audit records sharing a single `appeal_id`:

1. `Refused per <venom-policy-id>: ...` (original refusal)
2. `Appealed per N10: ...` (Smith filing)
3. One `Reviewed per <head>: ...` per participating head
4. `Resolved per N10: outcome=<...>` (final)
5. If `outcome=reversed` or `narrowed`: the resulting `eights.evolution.commit` audit line for the policy change

Missing any of records 1, 2, or 4 is an `audit-gap` anomaly (see `anomaly-signatures`).

## Failure modes

- **Venom gate unreachable** — appeal cannot be filed. Smith does NOT proceed with the original action. Refuse per N10.
- **Quorum stalled >24h** — auto-escalate to immortal-head with `expiry_breached=true`. Capability stays in its pre-appeal state (refused if originally refused).
- **Self-appeal attempt** — refuse; emit `replication-quota-breach`-adjacent log; investigate clone.
- **Constitution-bound capability** — if the disputed capability touches a constitution-frozen path, the appeal auto-escalates to `escalated_to_constitution` and routes through `evolution-handoff` with risk_class=critical.

## Related skills

- `matrix-invariants` (N10, N2, N4, N5)
- `anomaly-signatures` (`venom-capability-shadow`, `audit-gap`)
- `evolution-handoff` (critical-risk path)
- `quarantine-protocol` (venom config is frozen)
