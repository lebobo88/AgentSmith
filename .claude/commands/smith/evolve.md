---
description: Drive a propose -> evaluate -> commit cycle for a governed resource via TheEights.
argument-hint: "<rid> [--auto|--hitl]"
model: opus
---

# /smith:evolve

Dispatches **oracle-evaluator**. Closes the learning loop.

## Steps

1. Parse `<rid>` (TheEights resource id, e.g. `resource:agentsmith.template.agent`).
2. Build evidence: gather recent decision records, anomaly events, and any operator-attached context.
3. Call `mcp__agentsmith__factory_promote` with the draft + applicable rubric ids (default: `smith-artifact-stability@1`, `smith-invariant-coherence@1`).
4. If `--auto` and risk_class is low and the evaluation passes, the daemon will auto-commit via TheEights. Otherwise the proposal lands in HITL.
5. Render the proposal id, evaluation report, and commit/HITL status.

## HITL gates

- risk_class >= medium → HITL required (N3).
- Smith may not commit (N4).
