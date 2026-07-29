/**
 * Task JSON ↔ draft JSON ↔ deliverables JSON consistency (read-only dual-truth guard).
 *
 * Preferred read path: structured JSON under `matters/<id>/` and `drafts/` /
 * `tasks/` when present; Markdown CASE/projection is secondary.
 */

import {
  listDeliverablesForMatter,
  listMatterIdsFromStorage,
} from "../adapters/matter-storage/index.js";
import { listDrafts } from "../drafts/index.js";
import { listTaskRecords } from "../tasks/index.js";

export type TaskDraftConsistencyIssue = {
  taskId: string;
  code:
    | "orphan_draft"
    | "missing_draft_for_deliverable_task"
    | "deliverable_draft_missing"
    | "deliverable_review_drift";
  message: string;
  matterId?: string;
  deliverableId?: string;
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

  // drafts ↔ deliverables (JSON preferred under matters/<id>/deliverables/)
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    for (const d of listDeliverablesForMatter(workspaceDir, matterId)) {
      const linked = d.currentDraftTaskId?.trim() || d.taskId?.trim();
      if (!linked || d.status === "planned") {
        continue;
      }
      const draft = draftByTask.get(linked);
      if (!draft) {
        issues.push({
          taskId: linked,
          code: "deliverable_draft_missing",
          matterId,
          deliverableId: d.deliverableId,
          message: `交付物 ${d.deliverableId}（${d.status}）指向草稿 ${linked}，但 drafts/ 缺失`,
        });
        continue;
      }
      // Highest-risk dual-truth after missing draft: review stamp drift
      // (deliverable JSON vs drafts/<taskId>.json). Prefer JSON matter as read authority
      // for surfacing; do not auto-repair here.
      const delivReview = d.currentReviewStatus?.trim();
      const draftReview = String(draft.reviewStatus ?? "").trim();
      if (delivReview && draftReview && delivReview !== draftReview) {
        issues.push({
          taskId: linked,
          code: "deliverable_review_drift",
          matterId,
          deliverableId: d.deliverableId,
          message: `交付物 ${d.deliverableId} 审核态 ${delivReview} 与草稿 ${linked} 的 ${draftReview} 不一致（以 matters/.../deliverables JSON 为准核对）`,
        });
      }
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
