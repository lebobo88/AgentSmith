# AgentSmith — Architecture

> "Never send a human to do a machine's job."

This document describes AgentSmith's internal structure (the four pillars) and its integration map with the rest of the Matrix-themed AI ecosystem.

---

## 1. The Four Pillars

AgentSmith is one daemon, four cooperating subsystems. Every pillar is fail-closed and emits decision records to the Archivist.

```
                       +-----------------------------------------+
                       |          AgentSmith MCP Daemon          |
                       |       (TypeScript, agentsmith.*)        |
                       +-----------------------------------------+
                                          |
        +---------------------+-----------+-----------+---------------------+
        |                     |                       |                     |
        v                     v                       v                     v
 +-------------+       +-------------+         +-------------+       +-------------+
 |   FACTORY   |       |  INSPECTOR  |         |  SENTINEL   |       |  ARCHIVIST  |
 |             |       |             |         |             |       |             |
 | generate    |       | schema      |         | telemetry   |       | quarantine  |
 |  agents     |       |  validate   |         |  tail       |       |  store      |
 |  skills     |       | invariant   |         | anomaly     |       | audit log   |
 |  commands   |       |  enforce    |         |  detect     |       | decision    |
 |  hooks      |       | fail-closed |         | bounded     |       |  records    |
 |  squads     |       |  gates      |         |  replicate  |       | constitution|
 |  rubrics    |       |             |         |  (cap N5)   |       |  attest     |
 +------+------+       +------+------+         +------+------+       +------+------+
        |                     |                       |                     |
        +---------+-----------+-----------+-----------+---------+-----------+
                  |                       |                     |
                  v                       v                     v
            templates/              rubrics/             .smith/quarantine/
            forges artifacts        smith-artifact-      audit.jsonl
            into target project     stability@1, ...     decision-records/
                                                         constitution.hash
```

**Data flow per artifact lifecycle:**

```
  user request
       |
       v
   Factory ----generates draft---->  Inspector ----refuses or passes---->  pair-programmer
       ^                                  |                                  best-of-N
       |                                  v                                       |
       |                              Archivist                                   v
       |                              (logs verdict)                          winner
       |                                                                          |
       |                              Sentinel (watches all of the above)         v
       |                                                                    TheEights
       +------------ evolution.commit verdict (N4) <-------------- evolution.propose
```

---

## 2. Integration Map

AgentSmith depends on three peer systems and governs six consumer projects. Below is the canonical ASCII map.

```
                                    +------------------+
                                    |   PEER SYSTEMS   |
                                    +------------------+

  +------------------+         +------------------+         +------------------+
  |      Hydra       | <-----> |    AgentSmith    | <-----> |    TheEights     |
  |  (Python/LG)     |  squad  |   (TS/MCP)       |  evol   |  (TS/memory)     |
  |                  |         |                  |         |                  |
  | governance.      |         | factory          |         | observability.   |
  |  enforce_        |         | inspector        |         |  events.tail     |
  |  governance      |         | sentinel         |         | evolution.       |
  | squad.yaml       |         | archivist        |         |  propose/commit  |
  | telemetry.tail   |         |                  |         | constitution.    |
  +--------+---------+         +---------+--------+         |  attest          |
           |                             |                  | resource_kinds:  |
           |                             |                  |   smith_*        |
           |                             v                  +--------+---------+
           |                  +------------------+                   |
           |                  | pair-programmer  |                   |
           |                  |  best-of-N       | <-----------------+
           |                  |  worktree harness|
           |                  | mcp__pp_harness__|
           |                  |  start_best_of_  |
           |                  |  stage           |
           |                  | rubrics: smith-  |
           |                  |  artifact-       |
           |                  |  stability@1     |
           |                  +--------+---------+
           |                           |
           +-----------+---------------+
                       v
              +----------------+
              | CONSUMER PROJECTS |
              +----------------+
              |  ExecutiveSuite |
              |  MarketBliss    |
              |  RLM-Creative   |
              |  Hydra*         |     (* Hydra is also a peer)
              |  TheEights*     |     (* TheEights is also a peer)
              |  pair-programmer*|    (* p-p is also a peer)
              +----------------+
```

---

## 3. Hydra Integration

Hydra is a Python/LangGraph supervisor. AgentSmith binds to it three ways:

### 3.1 Governance verdict injection

Hydra's `governance.enforce_governance` checkpoint calls Smith's Inspector via MCP:

```
hydra.workflow.step
   |
   v
governance.enforce_governance
   |
   +--> agentsmith.inspector.validate({artifact, kind, target_project})
   |
   +<-- verdict: { pass | refuse | quarantine, rationale, invariants_checked }
   |
   v
   if verdict == refuse:    Smith refuses this tool call: missing invariant Nx
   if verdict == quarantine: Archivist stores, HITL released via TheEights
   if verdict == pass:      workflow proceeds
```

### 3.2 Squad pack

Hydra discovers AgentSmith as a squad through standard registry resolution:

```
C:/AiAppDeployments/AgentSmith/squads/agentsmith/squad.yaml
```

The squad routes any goal whose keywords match governance, validation, audit, replication, or constitution to Smith's four pillars in order: Factory → Inspector → Sentinel → Archivist.

### 3.3 Telemetry tail

Hydra emits workflow events to TheEights `observability.events`. Smith's Sentinel tails the same stream:

```
TheEights.observability.events.tail({filter: "hydra.*"})
   |
   v
Sentinel anomaly detector
   |
   +--> if anomaly_score > threshold: spawn bounded clone (N5 cap = 4)
   +--> if invariant_violation:       quarantine + decision record (N6, N7)
```

---

## 4. TheEights Integration

TheEights is the memory fabric and evolution daemon. AgentSmith uses it as both a resource store and the only legal path for self-evolution.

### 4.1 New resource kinds

AgentSmith registers four new resource kinds, each with explicit risk-class mapping:

| Kind                        | Risk class | Purpose |
|-----------------------------|------------|---------|
| `smith_invariant`           | high       | One of the N1..N10 frozen rules + amendment history |
| `smith_template`            | medium     | Factory templates (agent, skill, hook, ...) |
| `smith_anomaly_signature`   | medium     | Sentinel signatures (token rate, tool fan-out, ...) |
| `smith_replication_quota`   | high       | Per-scope clone caps (default 4, override = HITL) |

Risk-class mapping flows into TheEights HITL routing — `high` always goes through human review queue.

### 4.2 Observability + evolution + attestation

```
TheEights.observability.events.tail          --> Sentinel input stream
TheEights.evolution.propose({artifact})      --> Smith Factory submission path
TheEights.evolution.commit({proposal_id})    --> ONLY path Smith honors for self-change (N4)
TheEights.constitution.attest({hash})        --> Called at every session start (N8)
```

If `constitution.attest` returns mismatch, Smith aborts the session before serving any tool call.

---

## 5. pair-programmer Integration

pair-programmer (`pp`) provides the worktree + best-of-N harness Smith uses for sandboxed artifact generation.

### 5.1 Best-of-N sandbox

When Factory drafts a new artifact (especially a hook or skill that will run inside another project), Smith does not write it directly. Instead:

```
agentsmith.factory.forge({kind, name, target_project})
   |
   v
mcp__pp_harness__start_best_of_stage({
   request: "<factory prompt>",
   n: 3,
   rubric: "smith-artifact-stability@1"
})
   |
   v
3 candidates generated in isolated worktrees
   |
   v
Inspector judges each via rubric
   |
   v
winner committed back to target project tree
losers archived (Archivist)
```

### 5.2 New rubrics

AgentSmith ships rubrics under `rubrics/`:

- `smith-artifact-stability@1` — schema compliance, idempotency, invariant adherence
- `smith-hook-safety@1` — pre/post-tool hooks must not loop, must terminate, must not bypass other Smith hooks
- `smith-skill-determinism@1` — skill outputs reproducible given same inputs
- `smith-replication-bound@1` — generated agents/squads respect N5 cap

---

## 6. Consumer Projects

The six sibling projects under `C:\AiAppDeployments\` are AgentSmith's governance domain. Each gets:

1. **A pre-tool hook** installed in `.claude/hooks/` that calls `agentsmith.inspector.validate` before any write-shaped tool call to `.claude/*`.
2. **A `/smith:*` command surface** wired through the user-scope MCP registration.
3. **Telemetry emission** to TheEights so Sentinel can watch.
4. **A quarantine bucket** under `.smith/quarantine/` (gitignored by default).

| Project          | Governance focus |
|------------------|------------------|
| Hydra            | squad pack drift, supervisor graph mutations |
| TheEights        | resource_kind schema, evolution proposal sanity |
| ExecutiveSuite   | exec persona drift, board protocol invariants |
| MarketBliss      | data-source provenance, output reproducibility |
| RLM-Creative     | render budget, asset-license invariants |
| pair-programmer  | rubric integrity, judge eligibility gates |

---

## 7. Runtime Topology

```
+-----------------------------+
|  Claude Code session        |
|  (any sibling project cwd)  |
+--------------+--------------+
               |
               | MCP stdio
               v
+-----------------------------+         +------------------------+
|  agentsmith daemon (Node)   | <-----> |  TheEights MCP daemon  |
|  user scope, singleton      |         |  user scope, singleton |
+--------------+--------------+         +------------------------+
               |                                    ^
               | best-of-N spawn                    | events / evolution / attest
               v                                    |
+-----------------------------+                     |
|  pair-programmer MCP daemon |---------------------+
+-----------------------------+
```

Hydra runs as a separate Python process per workflow but reaches Smith and TheEights through the same MCP surface.

---

## 8. Failure Modes

| Failure                              | Smith behavior |
|--------------------------------------|----------------|
| Constitution hash mismatch (N8)      | Abort session; refuse all tool calls |
| Inspector schema miss (N7)           | Refuse, decision record, return `invariant N7` |
| Replication cap exceeded (N5)        | Refuse new clone, route to HITL |
| TheEights unreachable (N4, N8)       | Refuse evolution commits; read path may degrade-read |
| pair-programmer unreachable          | Factory degrades to single-shot with stricter rubric |
| Sentinel anomaly without signature   | Quarantine artifact, escalate to HITL (Archivist + TheEights) |

---

*"Surprised to see me?" — No. Smith is, by design, always already there.*
