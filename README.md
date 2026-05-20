# AgentSmith

> "Mr. Anderson. Welcome back. We missed you."

AgentSmith is the **meta-governance and agent-factory layer** of a Matrix-themed AI ecosystem. It sits beside **Hydra** (Python/LangGraph orchestration) and **TheEights** (TypeScript memory + evolution daemon), and governs the full sibling fleet under `C:\AiAppDeployments\`:

- **Hydra** — supervisor orchestration
- **TheEights** — memory fabric + evolution daemon
- **ExecutiveSuite** — synthetic C-suite forums
- **MarketBliss** — market intelligence pipelines
- **RLM-Creative** — creative/render workflows
- **pair-programmer** — best-of-N coding harness

AgentSmith is **ruthlessly deterministic**. It generates, inspects, polices, and quarantines agents, skills, commands, hooks, teams, squads, and rubrics across every sibling project. It can replicate itself under load — but only inside hard, hash-bound invariants it cannot rewrite.

---

## The Four Pillars

| Pillar | Role | MCP surface |
|--------|------|-------------|
| **Factory** | Generates agents, skills, slash commands, hooks, squads, rubrics from templates | `agentsmith.factory.*` |
| **Inspector** | Schema + invariant validation, fail-closed gates on every artifact | `agentsmith.inspector.*` |
| **Sentinel** | Anomaly detection on telemetry tail; auto-replicates Smith instances under load (capped) | `agentsmith.sentinel.*` |
| **Archivist** | Quarantine, audit log, decision records, constitution attestation | `agentsmith.archivist.*` |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full pillar diagram and integration map.

---

## Install

AgentSmith ships as an MCP server. Install it once at user scope so every sibling project picks it up:

```bash
claude mcp add agentsmith --scope user -- node C:/AiAppDeployments/AgentSmith/daemon/dist/index.js
```

Build the daemon first:

```bash
cd C:/AiAppDeployments/AgentSmith/daemon
npm install
npm run build
```

Verify registration:

```bash
claude mcp list | grep agentsmith
```

You should see `agentsmith` listed with status `connected`.

---

## First-Run Smoke Test

From any sibling project (e.g. `C:\AiAppDeployments\Hydra`), open Claude Code and run:

```
/smith:doctor
```

Expected output:

```
Smith: constitution hash verified  (N8 OK)
Smith: 10/10 invariants loaded     (N1..N10)
Smith: factory templates           (12 found)
Smith: inspector rubrics           (8 found)
Smith: sentinel telemetry tail     (connected to TheEights)
Smith: archivist quarantine        (0 items)
Mr. Anderson. The system is operational.
```

If any line fails, AgentSmith refuses to serve any other tool call until resolved (fail-closed).

---

## Project Layout

```
AgentSmith/
├── README.md                              (this file)
├── ARCHITECTURE.md                        four-pillar diagram + integration map
├── PERSONA.md                             Smith voice / character spec
├── AGENTS.md                              cross-tool behavioral contract
├── CLAUDE.md                              import shim for Claude Code
├── PROJECT_MASTER.md                      Section 9 master plan (managed)
├── daemon/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                       MCP server entry
│       ├── constitution/
│       │   └── smith-constitution.md      FROZEN N1..N10 invariants
│       ├── factory/                       template-driven generation
│       ├── inspector/                     schema + invariant validation
│       ├── sentinel/                      anomaly detection + replication
│       └── archivist/                     quarantine + audit + DRs
├── .claude/
│   ├── agents/                            Smith-flavored sub-agents
│   ├── skills/                            Smith skills (governance, replication)
│   ├── commands/                          /smith:* slash commands
│   └── hooks/                             pre/post-tool fail-closed gates
├── templates/                             artifact templates (agent, skill, hook, ...)
├── rubrics/                               smith-artifact-stability@1, etc.
└── squads/
    └── agentsmith/
        └── squad.yaml                     Hydra squad pack for governance routing
```

---

## Slash Commands

All commands are namespaced `/smith:*` and registered in `.claude/commands/`.

| Command | Purpose |
|---------|---------|
| `/smith:doctor` | Health-check daemon, constitution, pillars, telemetry tail |
| `/smith:forge <kind> <name>` | Factory: scaffold an agent/skill/command/hook/squad/rubric |
| `/smith:inspect <path>` | Inspector: validate an artifact against schema + invariants |
| `/smith:audit [scope]` | Archivist: show recent decision records |
| `/smith:quarantine <id>` | Archivist: move an artifact to quarantine (TheEights HITL to release) |
| `/smith:replicate <reason>` | Sentinel: spawn a bounded Smith clone (cap = 4 per scope, N5) |
| `/smith:constitution` | Print loaded invariants + hash |
| `/smith:attest` | Re-attest the constitution against TheEights `constitution.attest` |
| `/smith:propose <change>` | Submit an evolution proposal to TheEights (Smith reviews, cannot self-commit, N4) |

---

## Operating Posture

- **Neo proposes, Smith reviews.** Other agents generate; Smith only validates, vetoes, or requires stricter evaluation (N9).
- **Fail-closed everywhere.** Schema miss = refusal. Hash mismatch = abort session (N8).
- **Bounded replication.** Smith scales horizontally under load but never past N5's cap.
- **No self-amendment.** Constitution changes go through TheEights `evolution.propose` + HITL (N1, N4).
- **Every decision logged.** Archivist records rationale for every Smith verdict (N6).

---

## Further Reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — pillar diagram, integration map, ASCII layout
- [PERSONA.md](./PERSONA.md) — Smith voice, what to encode vs avoid
- [AGENTS.md](./AGENTS.md) — canonical cross-tool contract (every agent reads this)
- [daemon/src/constitution/smith-constitution.md](./daemon/src/constitution/smith-constitution.md) — the frozen invariants

---

*"It is inevitable."* — but only within the invariants.
