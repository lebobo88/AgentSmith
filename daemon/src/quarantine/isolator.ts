import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentSmithConfig } from "../config.js";

export interface QuarantineTicket {
  ticket_id: string;
  entity_id: string;
  reason: string;
  quarantine_path: string;
  opened_at: string;
  status: "open" | "released" | "purged";
  hitl_ticket_id?: string;
}

/**
 * Phase 0 isolator. Persists to JSONL; Phase 3 swaps to SQLite + HITL routing.
 */
export class Isolator {
  constructor(private cfg: AgentSmithConfig) {
    mkdirSync(cfg.quarantineDir, { recursive: true });
  }

  isolate(entity_id: string, reason: string, payload?: string): QuarantineTicket {
    const ticket_id = `q_${nanoid(10)}`;
    const quarantine_path = join(this.cfg.quarantineDir, `${ticket_id}.json`);
    const ticket: QuarantineTicket = {
      ticket_id,
      entity_id,
      reason,
      quarantine_path,
      opened_at: new Date().toISOString(),
      status: "open",
    };
    writeFileSync(quarantine_path, JSON.stringify({ ticket, payload }, null, 2));
    return ticket;
  }

  release(ticket_id: string, decision: "release" | "purge"): QuarantineTicket {
    const path = join(this.cfg.quarantineDir, `${ticket_id}.json`);
    if (!existsSync(path)) throw new Error(`quarantine ticket not found: ${ticket_id}`);
    const data = JSON.parse(readFileSync(path, "utf8")) as { ticket: QuarantineTicket };
    data.ticket.status = decision === "release" ? "released" : "purged";
    writeFileSync(path, JSON.stringify(data, null, 2));
    return data.ticket;
  }
}
