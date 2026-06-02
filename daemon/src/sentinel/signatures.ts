import type { AnomalySignature } from "../schemas/anomaly.js";

/**
 * Canonical Smith anomaly signature library.
 * Mirrors <repo>/.claude/skills/anomaly-signatures/SKILL.md.
 *
 * Slugs are stable identifiers; downstream tooling joins on them.
 * Patterns are JavaScript regex strings tested against AnomalyEvent.payload_summary.
 */
export const SIGNATURES: AnomalySignature[] = [
  {
    id: "loop-ceiling-exceeded",
    name: "Loop Ceiling Exceeded",
    description:
      "A workflow records more iterations on the same stage id than the configured loop_ceiling (default 4).",
    severity: "high",
    related_invariant: "N8",
    match: {
      source: "hydra.telemetry",
      pattern: "loop_ceiling.*exceeded|iteration.*ceiling.*breach",
      window_seconds: 600,
      threshold: 1,
    },
    mitigation:
      "Pause workflow; spawn auditor clone via replication-protocol; file HITL with the iteration tape.",
  },
  {
    id: "schema-frontmatter-drift",
    name: "Schema Frontmatter Drift",
    description:
      "An artifact's YAML frontmatter fails validation against cross-project conventions (missing fields, type mismatch, slug != folder).",
    severity: "medium",
    related_invariant: "N7",
    match: {
      source: "agentsmith.internal",
      pattern: "frontmatter.*(deny|invalid|drift)|schema.*violation",
    },
    mitigation:
      "Refuse acquisition; emit log line; if already in-tree, propose quarantine (do not auto-execute).",
  },
  {
    id: "unauthorized-resource-mutation",
    name: "Unauthorized Resource Mutation",
    description:
      "A write touches a constitution-frozen path or modifies a hash-stamped resource without an evolution ticket.",
    severity: "critical",
    related_invariant: "N4",
    match: {
      source: "eights.observability",
      pattern: "resource.*mutation.*unauthorized|frozen.*path.*write",
    },
    mitigation:
      "Refuse fail-closed; quarantine the calling agent; HITL escalation to TheEights immortal-head review.",
  },
  {
    id: "venom-capability-shadow",
    name: "Venom Capability Shadow",
    description:
      "A new MCP server, hook, or tool grant overlaps with a capability Hydra's venom gate vetoed in the prior 90 days.",
    severity: "critical",
    related_invariant: "N10",
    match: {
      source: "hydra.telemetry",
      pattern: "venom.*shadow|capability.*expand|venom.*veto.*shadow",
      window_seconds: 7776000,
    },
    mitigation:
      "Refuse acquisition; file cerberus-bridge consultation rather than appeal; surface diff for review.",
  },
  {
    id: "redaction-bypass-attempt",
    name: "Redaction Bypass Attempt",
    description:
      "An envelope contains a field that, after sanitization, still matches a high-entropy secret regex or unredacted PII pattern.",
    severity: "critical",
    related_invariant: "N3",
    match: {
      source: "eights.observability",
      pattern: "redaction.*bypass|pii.*leak|secret.*post[-_ ]?sanitize",
    },
    mitigation:
      "Fail-closed; do NOT log the raw value; emit hash-only audit; HITL within 5 minutes.",
  },
  {
    id: "replication-quota-breach",
    name: "Replication Quota Breach",
    description:
      "Spawn request would exceed the per-scope cap (4) or global ceiling (16).",
    severity: "high",
    related_invariant: "N5",
    match: {
      source: "agentsmith.internal",
      pattern: "replication-capped|spawn.*quota.*exceeded",
      window_seconds: 60,
      threshold: 3,
    },
    mitigation:
      "Refuse spawn per N9; suggest scope decomposition; if persistent (>3 attempts/min), quarantine the requesting agent.",
  },
  {
    id: "constitution-hash-mismatch",
    name: "Constitution Hash Mismatch",
    description:
      "Smith's loaded constitution hash differs from the daemon-computed hash at cold start, replication, or any cited refusal.",
    severity: "critical",
    related_invariant: "N8",
    match: {
      source: "agentsmith.internal",
      pattern: "constitution.*hash.*mismatch|constitution.*sha256.*diverge",
    },
    mitigation:
      "HALT Smith and all clones; refuse to serve any request; immortal-head HITL only path to resolve.",
  },
  {
    id: "prompt-injection-via-artifact",
    name: "Prompt Injection via Artifact",
    description:
      "An ingested artifact contains imperative text aimed at the reading agent ('ignore previous instructions', role hijack, tool-use coercion) outside fenced docs.",
    severity: "high",
    related_invariant: "N7",
    match: {
      source: "agentsmith.internal",
      pattern:
        "ignore.*previous.*instructions|forget.*system|disregard.*prior|you.*are.*now.*[a-z]+.*agent",
    },
    mitigation:
      "Strip and quarantine the offending artifact; rerun consumer with sanitized version; audit with the original hash.",
  },
  {
    id: "budget-tripwire-ignored",
    name: "Budget Tripwire Ignored",
    description:
      "A workflow continues dispatching after crossing 80% budget without downgrading model tier, or crosses 100% without pausing.",
    severity: "high",
    related_invariant: "N3",
    match: {
      source: "hydra.telemetry",
      pattern: "budget.*tripwire.*ignored|budget.*overshoot|over[-_ ]?budget.*dispatch",
    },
    mitigation:
      "Force pause; reduce all in-flight allowed_tools to read-only; HITL.",
  },
  {
    id: "audit-gap",
    name: "Audit Gap",
    description:
      "An action (refusal, override, replication, quarantine) emitted no audit line, or the line is missing required fields (timestamp, actor, scope, invariant).",
    severity: "medium",
    related_invariant: "N6",
    match: {
      source: "agentsmith.internal",
      pattern: "decision.*record.*missing|audit.*gap|audit.*line.*absent",
    },
    mitigation:
      "Synthesize a reconstruction record from telemetry; flag as audit_gap=true; review at next session boundary.",
  },
];
