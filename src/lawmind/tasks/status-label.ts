import type { TaskExecutionState } from "../platform/contracts.js";
import type { ArtifactDraft, TaskLifecycleStatus, TaskRecord } from "../types.js";

/** Human-readable task status for desktop lists and GET /api/tasks/:id. */
export function resolveTaskStatusLabel(input: {
  status: TaskLifecycleStatus;
  reviewStatus?: ArtifactDraft["reviewStatus"];
  executionState?: TaskExecutionState;
  outputPath?: string | null;
}): string {
  const review = input.reviewStatus ?? "pending";
  const exec = input.executionState;

  if (exec?.phase === "clarify" || exec?.status === "awaiting_clarification") {
    return "待澄清";
  }
  if (exec?.phase === "approval" || exec?.status === "awaiting_approval") {
    return "待审批";
  }

  if (review === "approved" && input.outputPath?.trim()) {
    return "已交付";
  }
  if (review === "approved") {
    return "可渲染";
  }
  if (review === "modified") {
    return "需修改";
  }
  if (review === "rejected") {
    return "已驳回";
  }

  switch (input.status) {
    case "completed":
    case "rendered":
      return review === "pending" ? "待审核" : "已完成";
    case "researching":
    case "researched":
    case "drafted":
      return "执行中";
    case "rejected":
      return "已驳回";
    case "created":
    case "confirmed":
      return "进行中";
    case "reviewed":
      return review === "pending" ? "待审核" : "已审阅";
    default:
      return "进行中";
  }
}

export function taskRecordStatusLabel(record: TaskRecord): string {
  return resolveTaskStatusLabel({
    status: record.status,
    reviewStatus: record.reviewStatus,
    outputPath: record.outputPath,
  });
}
