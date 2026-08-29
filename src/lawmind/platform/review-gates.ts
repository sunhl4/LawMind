/**
 * Review/workbench gate decision derivation — shared by desktop server and UI.
 */

import type { AcceptanceReport } from "../deliverables/index.js";
import type { ArtifactDraft } from "../types.js";
import type { GateDecision } from "./contracts.js";
import { withGateCategory } from "./gate-category.js";

export function deriveReviewGateDecisions(
  draft: ArtifactDraft,
  acceptance?: AcceptanceReport,
): GateDecision[] {
  const reviewStatus = draft.reviewStatus ?? "pending";
  const gates: GateDecision[] = [];
  if (reviewStatus === "pending") {
    gates.push(
      withGateCategory({
        gate: "approval_gate",
        decision: "awaiting_confirmation",
        reason: "等待律师签批。",
      }),
    );
  } else if (reviewStatus === "approved") {
    gates.push(
      withGateCategory({
        gate: "approval_gate",
        decision: "allow",
        reason: "草稿已通过签批。",
      }),
    );
  } else {
    gates.push(
      withGateCategory({
        gate: "clarification_gate",
        decision: "block",
        reason: reviewStatus === "modified" ? "草稿需修改后再推进。" : "草稿已驳回，需重新处理。",
      }),
    );
  }
  if (acceptance) {
    gates.push(
      withGateCategory({
        gate: "acceptance_gate",
        decision: acceptance.ready ? "allow" : "block",
        reason: acceptance.ready ? "出稿检查已通过。" : "出稿检查尚有待补项。",
      }),
    );
  }
  return gates;
}

export function gateDecisionLabel(gate: GateDecision["gate"]): string {
  const labels: Record<GateDecision["gate"], string> = {
    clarification_gate: "待补充",
    intake_gate: "交办前问清",
    dangerous_tool_gate: "需批准",
    approval_gate: "待签批",
    acceptance_gate: "出稿检查",
    reasoning_gate: "依据检查",
    redline_hunks_gate: "空修订拦截",
    surgical_span_gate: "最短锚定拦截",
    citation_integrity_gate: "引用对不上来源",
    outbound_privilege_gate: "发前需确认特权",
    outbound_recipient_gate: "发前需确认收件人",
  };
  return labels[gate];
}

export function listBlockingGateDecisions(
  gates: GateDecision[] | undefined | null,
): GateDecision[] {
  if (!gates?.length) {
    return [];
  }
  return gates.filter((g) => g.decision === "block" || g.decision === "awaiting_confirmation");
}

export function formatGateDecisionLine(gate: GateDecision): string {
  const label = gateDecisionLabel(gate.gate);
  return gate.reason ? `${label}：${gate.reason}` : label;
}

export function acceptanceTopBlockers(report: AcceptanceReport, limit = 3): string[] {
  return report.checks
    .filter((c) => !c.passed && c.severity === "blocker")
    .slice(0, limit)
    .map((c) => c.label.trim() || c.key);
}
