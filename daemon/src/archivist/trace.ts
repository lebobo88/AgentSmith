import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SmithDecisionRecord } from "../schemas/decision-record.js";
import type { EightsBridge } from "../bridges/index.js";

const MAX_FILE_BYTES = 1024 * 1024; // 1MB cap
const MAX_TRACE_LINES = 200;
const DEFAULT_HYDRA_TAIL_DIR = "C:/AiAppDeployments/Hydra/.hydra";

export interface CrossSystemLink {
  source: "smith" | "hydra" | "eights";
  kind: string;
  ts?: string;
  ref: string;
  payload?: unknown;
}

export interface AuditSummary {
  decision_count: number;
  hydra_event_count: number;
  eights_event_count: number;
  time_span_ms: number;
  degraded?: boolean;
}

export interface AuditReport {
  query: { workflow_id?: string; trace_id?: string };
  decisions: SmithDecisionRecord[];
  generated_at: string;
  cross_system_links: CrossSystemLink[];
  summary: AuditSummary;
}

export interface BuildAuditContext {
  hydraTailDir?: string;
  eightsBridge?: EightsBridge;
}

function tsMs(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function readHydraTrace(workflowId: string, hydraTailDir: string): CrossSystemLink[] {
  const out: CrossSystemLink[] = [];
  try {
    const traceFile = join(hydraTailDir, workflowId, "trace.jsonl");
    if (!existsSync(traceFile)) return out;
    const st = statSync(traceFile);
    if (st.size > MAX_FILE_BYTES) {
      // Read only the tail of the file up to 1MB if oversized.
      // Simpler: skip oversized to honor cap deterministically.
      return out;
    }
    const text = readFileSync(traceFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean).slice(0, MAX_TRACE_LINES);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as Record<string, unknown>;
        const kind =
          typeof ev["kind"] === "string"
            ? (ev["kind"] as string)
            : typeof ev["event"] === "string"
              ? (ev["event"] as string)
              : "event";
        const ts =
          typeof ev["ts"] === "string"
            ? (ev["ts"] as string)
            : typeof ev["timestamp"] === "string"
              ? (ev["timestamp"] as string)
              : undefined;
        out.push({
          source: "hydra",
          kind,
          ts,
          ref: `hydra:${workflowId}`,
          payload: ev,
        });
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // degraded
  }
  return out;
}

export async function buildAudit(
  query: { workflow_id?: string; trace_id?: string },
  decisions: SmithDecisionRecord[],
  context: BuildAuditContext = {},
): Promise<AuditReport> {
  let degraded = false;

  // Filter decisions by query.
  const filtered = decisions.filter((d) => {
    if (query.workflow_id && d.workflow_id !== query.workflow_id) return false;
    if (query.trace_id && d.trace_id !== query.trace_id) return false;
    return true;
  });

  const sortedDecisions = [...filtered].sort((a, b) => {
    const ta = tsMs(a.sealed_at) ?? 0;
    const tb = tsMs(b.sealed_at) ?? 0;
    return ta - tb;
  });

  const links: CrossSystemLink[] = [];

  // (a) audit_links from decisions become smith-side cross links.
  for (const d of sortedDecisions) {
    for (const al of d.audit_links ?? []) {
      links.push({
        source: "smith",
        kind: "audit_link",
        ts: d.sealed_at,
        ref: al,
      });
    }
  }

  // (b) Hydra trace.jsonl, if a workflow_id is provided.
  if (query.workflow_id) {
    const hydraDir = context.hydraTailDir ?? DEFAULT_HYDRA_TAIL_DIR;
    const before = links.length;
    const hydra = readHydraTrace(query.workflow_id, hydraDir);
    if (hydra.length === 0) {
      // Could be empty trace or missing; don't mark degraded purely on absence.
    }
    for (const l of hydra) links.push(l);
    if (hydra.length === 0 && links.length === before) {
      // no-op
    }
  }

  // (c) TheEights audit.trace if trace_id provided.
  if (query.trace_id && context.eightsBridge) {
    try {
      const trace = await context.eightsBridge.auditTrace({ trace_id: query.trace_id });
      if ("degraded" in trace && trace.degraded) degraded = true;
      for (const ev of trace.events ?? []) {
        links.push({
          source: "eights",
          kind: ev.kind,
          ts: ev.ts,
          ref: `eights:${query.trace_id}`,
          payload: ev.payload,
        });
      }
    } catch {
      degraded = true;
    }
  } else if (query.trace_id && !context.eightsBridge) {
    degraded = true;
  }

  // Sort cross_system_links chronologically (those with ts first).
  links.sort((a, b) => {
    const ta = tsMs(a.ts);
    const tb = tsMs(b.ts);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });

  const hydraCount = links.filter((l) => l.source === "hydra").length;
  const eightsCount = links.filter((l) => l.source === "eights").length;

  // Time span across decisions + linked events.
  const allTs: number[] = [];
  for (const d of sortedDecisions) {
    const t = tsMs(d.sealed_at);
    if (t !== null) allTs.push(t);
  }
  for (const l of links) {
    const t = tsMs(l.ts);
    if (t !== null) allTs.push(t);
  }
  const time_span_ms =
    allTs.length >= 2 ? Math.max(...allTs) - Math.min(...allTs) : 0;

  const summary: AuditSummary = {
    decision_count: sortedDecisions.length,
    hydra_event_count: hydraCount,
    eights_event_count: eightsCount,
    time_span_ms,
  };
  if (degraded) summary.degraded = true;

  return {
    query,
    decisions: sortedDecisions,
    generated_at: new Date().toISOString(),
    cross_system_links: links,
    summary,
  };
}
