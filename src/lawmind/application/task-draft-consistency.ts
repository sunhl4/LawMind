/**
 * Task JSON ↔ draft JSON consistency (read-only dual-truth guard).
 */

import { listDrafts } from "../drafts/index.js";
import { listTaskRecords } from "../tasks/index.js";

export type TaskDraftConsistencyIssue = {
  taskId: string;
  code: "orphan_draft" | "missing_draft_for_deliverable_task";
  message: string;
};

const DRAFT_EXPECTED_STATUSES = new Set<string>(["drafted", "reviewed", "rejected", "rendered"]);

export function checkTaskDraftConsistency(workspaceDir: string): TaskDraftConsistencyIssue[] {
  const tasks = listTaskRecords(workspaceDir);
  const drafts = listDrafts(workspaceDir);
  const taskIds = new Set(tasks.map((t) => t.taskId));
  const draftByTask = new Map(drafts.map((d) => [d.taskId, d]));
  const issues: TaskDraftConsistencyIssue[] = [];

  for (const draft of drafts) {
    if (!taskIds.has(draft.taskId)) {
      issues.push({
        taskId: draft.taskId,
        code: "orphan_draft",
        message: `存在 drafts/${draft.taskId}.json，但 tasks/ 下无对应任务记录`,
      });
    }
  }

  for (const task of tasks) {
    const status = String(task.status ?? "").toLowerCase();
    const expectsDraft =
      Boolean(task.deliverableType) &&
      (DRAFT_EXPECTED_STATUSES.has(status) ||
        Boolean(task.outputPath?.trim()) ||
        task.reviewStatus);
    if (!expectsDraft) {
      continue;
    }
    if (!draftByTask.has(task.taskId)) {
      issues.push({
        taskId: task.taskId,
        code: "missing_draft_for_deliverable_task",
        message: `任务「${task.summary?.slice(0, 40) ?? task.taskId}」状态 ${task.status} 预期有草稿，但 drafts/ 缺失`,
      });
    }
  }

  return issues;
}

export function formatTaskDraftConsistencyReport(workspaceDir: string): string {
  const issues = checkTaskDraftConsistency(workspaceDir);
  if (issues.length === 0) {
    return "Task/draft consistency: OK";
  }
  const lines = issues.map((i) => `  - ${i.taskId}: [${i.code}] ${i.message}`);
  return ["Task/draft consistency issues:", ...lines].join("\n");
}
