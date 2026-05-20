---
name: quarantine-protocol
description: How AgentSmith isolates rogue artifacts and agents. Detect, suspend, sandbox, file HITL, await ruling, reinstate or purge. Includes what must NEVER be quarantined.
allowed-tools: Read, Bash, Write
---

# Quarantine Protocol

> "I'm going to enjoy watching you" — from the other side of a sandbox boundary, with a HITL ticket open.

Quarantine is the controlled isolation of an artifact (agent, skill, command, hook, team, squad, rubric, mcp config, output blob) suspected of violating an invariant or matching an anomaly signature. It is a **suspend**, not a **delete**.

## The 6 steps

```
1. detect       -> signature match OR human-filed concern
2. suspend      -> mark resource state=quarantined; deny new acquisitions
3. sandbox      -> move bytes to quarantine store, leave breadcrumb
4. ticket       -> open HITL via eights.governance.hitl.request
5. await        -> block all reads/writes except for the HITL reviewer
6. resolve      -> reinstate (restore + audit) OR purge (shred + audit)
```

Each step emits an audit record per N5. The ticket id is the join key across all six entries.

## Where things go

| Resource type | Original location                                | Quarantine path                                                          |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| skill         | `<proj>\.claude\skills\<slug>\`                  | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\skills\<slug>\`      |
| command       | `<proj>\.claude\commands\<name>.md`              | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\commands\`           |
| hook          | `<proj>\.claude\settings.json` (entry extracted) | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\hooks\<hash>.json`   |
| team/squad    | `<proj>\teams\` or `<proj>\squads\`              | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\teams\`              |
| mcp config    | `<proj>\.mcp.json` entry                         | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\mcp\<name>.json`     |
| output blob   | runtime artifact path                            | `C:\AiAppDeployments\AgentSmith\quarantine\<ticket>\blobs\<hash>`        |

A breadcrumb file `QUARANTINED.md` replaces the original, citing the ticket id, signature, and timestamp.

## HITL ticket envelope

Filed via `eights.governance.hitl.request` (see `hydra:cross-squad-message` for envelope schema). Required fields:

```yaml
ticket_kind: quarantine_review
resource_kind: <skill|command|hook|team|squad|rubric|mcp|blob|agent>
resource_id: <stable id or path>
signature: <anomaly-signature slug>
severity: <low|medium|high|critical>
evidence:
  - <log line / hash / diff>
proposed_action: <reinstate|purge|escalate>
expiry: PT24H   # fail-closed after this; resource stays quarantined
```

## What NOT to quarantine (guardrails)

The following are **constitution-frozen** and MUST refuse quarantine attempts; refusing emits `Refused per N4: constitution_immutability`:

- `C:\AiAppDeployments\AgentSmith\daemon\src\constitution\smith-constitution.md`
- Anything under `C:\AiAppDeployments\AgentSmith\daemon\src\constitution\`
- The Smith primary process (clones may be reaped; the primary may not)
- TheEights' evolution ledger (`<eights>\evolution\ledger\`)
- Hydra's venom gate config (`<hydra>\venom\policy\`)

Additional rule: **never quarantine an in-flight HITL ticket** or its referenced resource until the HITL resolves. Doing so would let Smith race a human reviewer. Refuse per N3.

## Reinstatement

On HITL approval, restore bytes from the quarantine path to the original location, validate against the appropriate schema (see `cross-project-conventions`), then emit:

```
Reinstated per ticket HITL-...: resource=<path> signature=<slug> verdict=false_positive
```

## Purge

On HITL purge decision, the bytes are moved to `C:\AiAppDeployments\AgentSmith\quarantine\_shredded\<ticket>\` and rendered unreadable to the daemon (renamed + chmod). True deletion is a separate retention job — quarantine never `rm`s on its own (N5).

## Related skills

- `anomaly-signatures` (sources of step 1)
- `matrix-invariants` (N3, N4, N5 cited above)
- `cerberus-bridge` (if quarantine target was a venom refusal)
