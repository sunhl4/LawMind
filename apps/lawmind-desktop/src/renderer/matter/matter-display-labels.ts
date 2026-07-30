/**
 * Matter workbench display labels — extracted from MatterWorkbench for reuse and testing.
 */

import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";

export function queueKindLabel(kind: WorkQueueItem["kind"]): string {
  switch (kind) {
    case "need_client_input":
      return "待客户输入";
    case "need_evidence":
      return "待补证据";
    case "need_conflict_check":
      return "待冲突检查";
    case "need_lawyer_review":
      return "待律师审核";
    case "need_partner_approval":
      return "待上级审批";
    case "ready_to_draft":
      return "可继续起草";
    case "ready_to_render":
      return "可渲染交付";
    case "blocked_by_deadline":
      return "期限阻塞";
    case "blocked_by_missing_strategy":
      return "策略未完善";
    default:
      return kind;
  }
}

export function approvalStatusLabel(status: ApprovalRequest["status"]): string {
  switch (status) {
    case "pending":
      return "待审批";
    case "approved":
      return "已批准";
    case "rejected":
      return "已驳回";
    case "needs_changes":
      return "需修改";
    default:
      return status;
  }
}

export function reviewStatusLabel(status: ArtifactDraft["reviewStatus"]): string {
  switch (status) {
    case "pending":
      return "待审核";
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "modified":
      return "需修改";
    default:
      return status;
  }
}

export function priorityLabel(priority: WorkQueueItem["priority"]): string {
  switch (priority) {
    case "critical":
      return "紧急";
    case "high":
      return "高";
    case "normal":
      return "中";
    case "low":
      return "低";
    default:
      return priority;
  }
}

export function riskLevelLabel(risk: string | undefined | null): string {
  switch (risk) {
    case "critical":
      return "紧急";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "normal":
      return "中";
    case "low":
      return "低";
    default:
      return risk?.trim() ? risk : "—";
  }
}

export function formatShortDateTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}
