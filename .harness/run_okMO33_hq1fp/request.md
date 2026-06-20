# Request

Harden AgentSmith's N8 constitution boot-attestation so a slow TheEights cold-start can never permanently wedge the daemon in n8-refusal. --repo agentsmith

Requirements:
(1a) Add a NEW N8-exempt MCP operational tool `agentsmith.constitution.reattest` that is allow-listed past the N8 refusal latch (it must be present and callable in the refusal map, not wrapped as a refusal) and re-runs the bridge attestation logic (the same attestOnce path used at boot in daemon/src/index.ts), and on success swaps the real tools into the live `tools` Map in place exactly like runAttest does at daemon/src/index.ts:163 — giving an operator an in-process recovery path with NO process restart. It MUST run the full hash verification (daemon/src/bridges/eights-bridge.ts constitutionAttest), returning a refusal/degraded result on hash mismatch or eights-unreachable, so invariant N8 is preserved and never weakened.
(1b) Make the N8 refusal `detail` accurate and live: instead of the static "boot attest pending" string set once in buildN8RefusalTools (daemon/src/mcp/tools.ts), refresh the detail as attest state changes — show transport-retry status (attempt N, last error) while retrying, and a distinct terminal detail on fail-closed — so smith.status can distinguish "still retrying" from "wedged terminal".
(1c) Boot robustness: make the eights connect timeout env-tunable via AGENTSMITH_EIGHTS_CONNECT_TIMEOUT_MS in daemon/src/bridges/mcp-client.ts with a larger default suited to a ~760MB-ledger cold start; wrap the `void runAttest()` call so an unhandled promise rejection cannot silently kill the background retry loop; and add escalation that emits a sentinel/HITL signal after K transport failures over T minutes instead of retrying silently forever.

HARD CONSTRAINTS: do NOT edit smith-constitution.md or any CONSTITUTION.md; do NOT weaken the N8 invariant; add unit tests covering (i) runAttest surviving an injected promise rejection and (ii) reattest success AND refusal-on-mismatch paths; the full daemon test suite must pass before the run is declared done.</goal>
<parameter name="squad">engineering
