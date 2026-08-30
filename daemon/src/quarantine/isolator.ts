import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

export interface QuarantineDiagnostic {
  file: string;
  reason: "malformed quarantine record";
}

export interface QuarantineListResult {
  /** Valid persisted quarantine tickets. Payloads are intentionally excluded. */
  tickets: QuarantineTicket[];
  /** Alias retained for consumers that use the generic list contract. */
  items: QuarantineTicket[];
  total: number;
  diagnostics: QuarantineDiagnostic[];
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

  /**
   * Read the quarantine directory without exposing persisted payloads.
   * Only regular JSON files directly inside the configured directory are read.
   * Malformed records are skipped with a bounded, non-sensitive diagnostic.
   */
  list(): QuarantineListResult {
    const root = resolve(this.cfg.quarantineDir);
    const tickets: QuarantineTicket[] = [];
    const diagnostics: QuarantineDiagnostic[] = [];

    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return { tickets, items: tickets, total: 0, diagnostics };
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = basename(entry.name);
      const filePath = resolve(root, file);
      if (dirname(filePath) !== root) {
        diagnostics.push({ file, reason: "malformed quarantine record" });
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
        const ticket = parsed && typeof parsed === "object" && "ticket" in parsed
          ? (parsed as { ticket?: unknown }).ticket
          : undefined;
        if (!isQuarantineTicket(ticket)) throw new Error("invalid ticket");
        if (ticket.ticket_id !== file.slice(0, -5)) throw new Error("ticket filename mismatch");
        // Derive this path from the confined filename. Never trust a persisted path.
        tickets.push({ ...ticket, quarantine_path: filePath });
      } catch {
        diagnostics.push({ file, reason: "malformed quarantine record" });
      }
    }

    tickets.sort((a, b) => a.ticket_id.localeCompare(b.ticket_id));
    return { tickets, items: tickets, total: tickets.length, diagnostics };
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

function isQuarantineTicket(value: unknown): value is QuarantineTicket {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.ticket_id === "string" && t.ticket_id.length > 0
    && typeof t.entity_id === "string" && typeof t.reason === "string"
    && typeof t.quarantine_path === "string" && typeof t.opened_at === "string"
    && (t.status === "open" || t.status === "released" || t.status === "purged")
    && (t.hitl_ticket_id === undefined || typeof t.hitl_ticket_id === "string");
}
