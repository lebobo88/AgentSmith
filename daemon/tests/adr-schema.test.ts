import { describe, it, expect } from "vitest";
import { checkSchema } from "../src/inspector/schema-checks.js";
import { ARTIFACT_KINDS } from "../src/schemas/artifact.js";

describe("AS1 — adr artifact kind + ADR structure validator", () => {
  it("includes 'adr' in ARTIFACT_KINDS", () => {
    expect((ARTIFACT_KINDS as readonly string[]).includes("adr")).toBe(true);
  });

  const VALID_ADR = `---
status: Accepted
date: 2026-05-21
deciders:
  - alice
  - bob
ai_provenance:
  generator: pp/architect@1
---
# ADR-0007: Adopt SQLite for local state

## Status

Accepted — this decision supersedes ADR-0003 (in-memory state).

## Context

The daemon needs a durable local store for state, decisions, and quarantine
records that survives restarts and supports concurrent reads.

## Decision

We will use SQLite via better-sqlite3 for all local persistence. The DB lives
in \`~/.agentsmith/state.db\` and is created on first run.

## Consequences

Positive: single-file durability, atomic transactions, no server to operate.
Negative: not horizontally scalable; concurrent writers are serialized via
better-sqlite3's WAL mode.

## Considered alternatives

We evaluated lmdb (faster but C-binding fragility on Windows), plain JSONL
(no atomic writes), and PostgreSQL (overkill for a local daemon).
`;

  it("accepts a valid ADR with frontmatter + all required sections", () => {
    const v = checkSchema({ kind: "adr", content: VALID_ADR, path: "docs/adr/ADR-0007.md" });
    expect(v.outcome).toBe("allow");
  });

  it("accepts synonym '## Considered alternatives' (pair-programmer adr_structure_lint synonym)", () => {
    // Already covered by VALID_ADR (which uses "Considered alternatives"),
    // but assert explicitly to lock the contract.
    expect(VALID_ADR).toContain("## Considered alternatives");
    const v = checkSchema({ kind: "adr", content: VALID_ADR });
    expect(v.outcome).toBe("allow");
  });

  it("rejects an ADR missing the Decision section", () => {
    const MISSING_DECISION = VALID_ADR.replace(
      /## Decision[\s\S]+?(?=## Consequences)/,
      "",
    );
    const v = checkSchema({ kind: "adr", content: MISSING_DECISION });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/Decision/);
  });

  it("rejects an ADR with no YAML frontmatter", () => {
    const v = checkSchema({
      kind: "adr",
      content: "# ADR-0001\n\n## Status\nAccepted\n",
    });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/frontmatter/i);
  });

  it("rejects an ADR with an invalid status value", () => {
    const BAD_STATUS = VALID_ADR.replace("status: Accepted", "status: WorkInProgress");
    const v = checkSchema({ kind: "adr", content: BAD_STATUS });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/status/i);
  });

  it("rejects an ADR missing the deciders list", () => {
    const NO_DECIDERS = VALID_ADR.replace(/deciders:\n  - alice\n  - bob\n/, "");
    const v = checkSchema({ kind: "adr", content: NO_DECIDERS });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/deciders/);
  });

  it("rejects an ADR missing the date field", () => {
    const NO_DATE = VALID_ADR.replace(/date: 2026-05-21\n/, "");
    const v = checkSchema({ kind: "adr", content: NO_DATE });
    expect(v.outcome).toBe("deny");
    expect(v.rationale).toMatch(/date/);
  });
});
