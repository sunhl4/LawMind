import { useMemo } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import { useMatterOverviewViewStore } from "../stores/matter-overview-view-store";

export function useMatterWorkbenchOps(input: {
  queueItems: WorkQueueItem[];
  approvalRequests: ApprovalRequest[];
  drafts: ArtifactDraft[];
}) {
  const { queueItems, approvalRequests, drafts } = input;
  const opsFocus = useMatterOverviewViewStore((s) => s.opsFocus);
  const opsSort = useMatterOverviewViewStore((s) => s.opsSort);

  const elevatedApprovals = useMemo(
    () =>
      approvalRequests.filter(
        (item) => item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high"),
      ),
    [approvalRequests],
  );

  const filteredQueueItems = useMemo(() => {
    const filtered = queueItems.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.kind === "need_lawyer_review" || item.kind === "need_partner_approval";
        case "modified":
          return item.kind === "need_lawyer_review" && (item.detail?.includes("修改") ?? false);
        case "delivery":
          return item.kind === "ready_to_render";
        case "highRisk":
          return item.priority === "critical" || item.priority === "high";
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      return byPriority !== 0 ? byPriority : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [opsFocus, opsSort, queueItems]);

  const filteredApprovalRequests = useMemo(() => {
    const filtered = approvalRequests.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.status === "pending";
        case "modified":
          return item.status === "needs_changes";
        case "delivery":
          return item.status === "approved";
        case "highRisk":
          return item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high");
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.reason.localeCompare(b.reason, "zh-CN");
      }
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (opsSort === "priority") {
        const byRisk = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        return byRisk !== 0 ? byRisk : b.requestedAt.localeCompare(a.requestedAt);
      }
      return b.requestedAt.localeCompare(a.requestedAt);
    });
  }, [approvalRequests, opsFocus, opsSort]);

  const filteredDrafts = useMemo(() => {
    const filtered = drafts.filter((draft) => {
      switch (opsFocus) {
        case "review":
          return draft.reviewStatus === "pending";
        case "modified":
          return draft.reviewStatus === "modified";
        case "delivery":
          return draft.reviewStatus === "approved";
        case "highRisk":
          return elevatedApprovals.some((item) => item.deliverableId === draft.taskId);
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      const statusOrder = { pending: 0, modified: 1, approved: 2, rejected: 3 };
      const byStatus = statusOrder[a.reviewStatus] - statusOrder[b.reviewStatus];
      return byStatus !== 0 ? byStatus : b.createdAt.localeCompare(a.createdAt);
    });
  }, [drafts, elevatedApprovals, opsFocus, opsSort]);

  const reviewTargetForFocus = useMemo(() => {
    switch (opsFocus) {
      case "review":
        return { statusFilter: "pending" as const, listMode: "pending" as const };
      case "modified":
        return { statusFilter: "modified" as const, listMode: "all" as const };
      case "delivery":
        return { statusFilter: "approved" as const, listMode: "all" as const };
      case "highRisk":
        return { statusFilter: "all" as const, listMode: "all" as const };
      default:
        return { statusFilter: "all" as const, listMode: "all" as const };
    }
  }, [opsFocus]);

  return {
    elevatedApprovals,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    reviewTargetForFocus,
  };
}
