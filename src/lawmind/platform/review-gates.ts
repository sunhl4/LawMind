/**
 * Review/workbench gate decision derivation — shared by desktop server and UI.
 */

import type { AcceptanceReport } from "../deliverables/index.js";
import type { ArtifactDraft } from "../types.js";
import type { GateDecision } from "./contracts.js";

export function deriveReviewGateDecisions(
  draft: ArtifactDraft,
  acceptance?: AcceptanceReport,
): GateDecision[] {
  const reviewStatus = draft.reviewStatus ?? "pending";
  const gates: GateDecision[] = [];
  if (reviewStatus === "pending") {
    gates.push({
      gate: "approval_gate",
      decision: "awaiting_confirmation",
      reason: "等待律师签批。",
    });
  } else if (reviewStatus === "approved") {
    gates.push({
      gate: "approval_gate",
      decision: "allow",
      reason: "草稿已通过签批。",
    });
  } else {
    gates.push({
      gate: "clarification_gate",
      decision: "block",
      reason: reviewStatus === "modified" ? "草稿需修改后再推进。" : "草稿已驳回，需重新处理。",
    });
  }
  if (acceptance) {
    gates.push({
      gate: "acceptance_gate",
      decision: acceptance.ready ? "allow" : "block",
      reason: acceptance.ready ? "已通过验收门禁。" : "验收门禁存在阻塞项。",
    });
  }
  return gates;
}

export function gateDecisionLabel(gate: GateDecision["gate"]): string {
  const labels: Record<GateDecision["gate"], string> = {
    clarification_gate: "澄清门禁",
    dangerous_tool_gate: "危险工具门禁",
    approval_gate: "审批门禁",
    acceptance_gate: "验收门禁",
    reasoning_gate: "推理门禁",
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
