---
description: Inspect, attest, or propose an amendment to the Smith constitution.
argument-hint: "[--show|--attest=<workflow_id>|--propose-amendment=<text> --rationale=<text>]"
model: sonnet
---

# /smith:constitution

## Steps

1. Parse the flag.
2. `--show`: call `mcp__agentsmith__constitution_get` and render the hash + invariants list.
3. `--attest=<wf>`: call `mcp__agentsmith__constitution_attest`.
4. `--propose-amendment`: call `mcp__agentsmith__constitution_propose_amendment` (always HITL — N3).

## HITL gates

- Amendments are critical-risk and always require operator approval.
