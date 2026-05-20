import { nanoid } from "nanoid";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SmithDecisionRecord } from "../schemas/decision-record.js";
import type { SmithVerdict } from "../schemas/verdict.js";
import type { AgentSmithConfig } from "../config.js";

export class DecisionStore {
  constructor(private cfg: AgentSmithConfig) {
    mkdirSync(dirname(cfg.decisionsPath), { recursive: true });
  }

  seal(input: {
    actor: string;
    subject_kind: string;
    subject_id: string;
    verdict: SmithVerdict;
    workflow_id?: string;
    trace_id?: string;
    parent_decision_id?: string;
    audit_links?: string[];
  }): SmithDecisionRecord {
    const decision: SmithDecisionRecord = {
      decision_id: `dec_${nanoid(12)}`,
      workflow_id: input.workflow_id,
      trace_id: input.trace_id,
      actor: input.actor,
      subject: { kind: input.subject_kind, id: input.subject_id },
      verdict: input.verdict,
      parent_decision_id: input.parent_decision_id,
      audit_links: input.audit_links ?? [],
      sealed: true,
      sealed_at: new Date().toISOString(),
    };
    appendFileSync(this.cfg.decisionsPath, JSON.stringify(decision) + "\n");
    return decision;
  }

  list(filter?: { actor?: string; outcome?: string; limit?: number }): SmithDecisionRecord[] {
    if (!existsSync(this.cfg.decisionsPath)) return [];
    const lines = readFileSync(this.cfg.decisionsPath, "utf8").split(/\r?\n/).filter(Boolean);
    const all = lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as SmithDecisionRecord];
      } catch {
        return [];
      }
    });
    let out = all;
    if (filter?.actor) out = out.filter((d) => d.actor === filter.actor);
    if (filter?.outcome) out = out.filter((d) => d.verdict.outcome === filter.outcome);
    if (filter?.limit) out = out.slice(-filter.limit);
    return out;
  }
}
