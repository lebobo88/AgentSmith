import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Isolator } from "../src/quarantine/index.js";
import type { AgentSmithConfig } from "../src/config.js";

function config(quarantineDir: string): AgentSmithConfig {
  return { quarantineDir } as AgentSmithConfig;
}

describe("Isolator.list", () => {
  it("returns stable tickets/items and total without persisted payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentsmith-quarantine-"));
    const isolator = new Isolator(config(dir));
    const ticket = isolator.isolate("agent-1", "N2", "SECRET-PAYLOAD");

    const result = isolator.list();
    expect(result.total).toBe(1);
    expect(result.tickets).toEqual(result.items);
    expect(result.tickets[0]).toMatchObject({ ticket_id: ticket.ticket_id, entity_id: "agent-1", status: "open" });
    expect(JSON.stringify(result)).not.toContain("SECRET-PAYLOAD");
    expect(readFileSync(ticket.quarantine_path, "utf8")).toContain("SECRET-PAYLOAD");
  });

  it("skips malformed records and returns only safe diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentsmith-quarantine-"));
    const isolator = new Isolator(config(dir));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ticket: { ticket_id: "q_bad", payload: "TOP-SECRET" } }));
    writeFileSync(join(dir, "broken.json"), "{not-json-with-secret}");
    writeFileSync(join(dir, "notes.txt"), "ignored");

    const result = isolator.list();
    expect(result.total).toBe(0);
    expect(result.tickets).toEqual([]);
    expect(result.diagnostics).toEqual([
      { file: "bad.json", reason: "malformed quarantine record" },
      { file: "broken.json", reason: "malformed quarantine record" },
    ]);
    expect(JSON.stringify(result)).not.toContain("TOP-SECRET");
    expect(JSON.stringify(result)).not.toContain("not-json-with-secret");
  });

  it("sorts valid tickets deterministically and tolerates a missing directory", () => {
    const dir = join(tmpdir(), "agentsmith-quarantine-missing-list");
    const result = new Isolator(config(dir)).list();
    expect(result).toEqual({ tickets: [], items: [], total: 0, diagnostics: [] });
  });
});
