import type { ArtifactDraft } from "../schemas/artifact.js";
import type { EvalReport } from "./eval-runner.js";
import type { EightsBridge } from "../bridges/index.js";

export interface PromotionTicket {
  ticket_id: string;
  draft_id: string;
  status: "queued" | "auto_committed" | "hitl_pending" | "rejected";
  eights_proposal_id?: string;
  auto_committed?: boolean;
  evaluated_at?: string;
  rationale: string;
}

interface DraftLike {
  draft_id?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  risk_class?: "low" | "medium" | "high" | "critical";
}

/**
 * Promote a draft. If eval passed and risk is low, propose evolution via TheEights.
 * If degraded or eval failed, route to HITL pending.
 */
export async function promote(
  draft: ArtifactDraft | DraftLike,
  eval_report: EvalReport,
  eightsBridge?: EightsBridge,
): Promise<PromotionTicket> {
  const d = draft as DraftLike;
  const draftId = d.draft_id ?? "unknown";
  const ticketBase = {
    ticket_id: `promo_${draftId}`,
    draft_id: draftId,
    evaluated_at: eval_report.evaluated_at,
  };

  if (!eval_report.pass) {
    return {
      ...ticketBase,
      status: eval_report.degraded ? "hitl_pending" : "rejected",
      rationale: eval_report.degraded
        ? `degraded evaluation; routed to HITL. ${eval_report.rationale}`
        : `eval failed: ${eval_report.rationale}`,
    };
  }

  const risk = d.risk_class ?? "low";
  if (risk !== "low") {
    return {
      ...ticketBase,
      status: "hitl_pending",
      rationale: `risk_class=${risk}; awaiting HITL. ${eval_report.rationale}`,
    };
  }

  if (!eightsBridge) {
    return {
      ...ticketBase,
      status: "hitl_pending",
      rationale: `eights bridge unavailable (degraded). ${eval_report.rationale}`,
    };
  }

  try {
    const resp = await eightsBridge.evolutionPropose({
      rid: `resource:agentsmith.draft.${draftId}`,
      candidate_content: d.content ?? "",
      justification: eval_report.rationale,
    });
    return {
      ...ticketBase,
      status: resp.auto_committed ? "auto_committed" : "queued",
      eights_proposal_id: resp.proposal_id,
      auto_committed: resp.auto_committed,
      rationale: `proposed via TheEights (auto_committed=${resp.auto_committed}). ${eval_report.rationale}`,
    };
  } catch (err) {
    return {
      ...ticketBase,
      status: "hitl_pending",
      rationale: `eights propose failed (degraded): ${String(err)}. ${eval_report.rationale}`,
    };
  }
}
