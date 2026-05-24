/**
 * Workspace-level session health — lightweight signals for Doctor / Matter UI.
 */

import fs from "node:fs";
import path from "node:path";
import { listMatterIdsFromStorage, readQueueItems } from "../adapters/matter-storage/index.js";
import { listSessions } from "../agent/session.js";
import { listDrafts } from "../drafts/index.js";
import { listPendingToolApprovals } from "../platform/pending-tool-approvals.js";
import { listTaskRecords } from "../tasks/index.js";

export type SessionHealthSignal = {
  id: string;
  label: string;
  severity: "info" | "warn" | "risk";
};

export type SessionHealthReport = {
  score: number;
  grade: "good" | "attention" | "risk";
  summary: string;
  signals: SessionHealthSignal[];
};

export function buildWorkspaceSessionHealth(workspaceDir: string): SessionHealthReport {
  const signals: SessionHealthSignal[] = [];
  let penalty = 0;

  const sessions = listSessions(workspaceDir);
  const pendingActions = sessions.reduce((n, s) => n + (s.pendingRequiresAction?.length ?? 0), 0);
  const toolApprovals = listPendingToolApprovals(workspaceDir);
  if (toolApprovals.length > 0) {
    signals.push({
      id: "tool_pending_approval",
      label: `${toolApprovals.length} 个危险工具调用待批准（见任务页「集中待批准」）`,
      severity: "warn",
    });
    penalty += Math.min(20, toolApprovals.length * 6);
  }

  if (pendingActions > 0) {
    signals.push({
      id: "chat_pending_actions",
      label: `${pendingActions} 个对话步骤待您确认或澄清`,
      severity: "warn",
    });
    penalty += Math.min(25, pendingActions * 8);
  }

  const jobsDir = path.join(workspaceDir, "jobs");
  let activeJobs = 0;
  try {
    for (const name of fs.readdirSync(jobsDir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const raw = fs.readFileSync(path.join(jobsDir, name), "utf8");
      const j = JSON.parse(raw) as { status?: string };
      if (j.status === "queued" || j.status === "running") {
        activeJobs += 1;
      }
    }
  } catch {
    activeJobs = 0;
  }
  if (activeJobs >= 2) {
    signals.push({
      id: "jobs_active",
      label: `${activeJobs} 个团队工作流任务仍在后台运行`,
      severity: "info",
    });
    penalty += Math.min(10, activeJobs * 2);
  }

  const tasks = listTaskRecords(workspaceDir);
  const stalledTasks = tasks.filter((t) => {
    const st = (t.status ?? "").toLowerCase();
    return st === "created" || st === "confirmed";
  }).length;
  if (stalledTasks >= 5) {
    signals.push({
      id: "tasks_stalled",
      label: `${stalledTasks} 个任务仍停留在早期阶段，建议在任务看板跟进`,
      severity: "info",
    });
    penalty += Math.min(10, stalledTasks);
  }

  const failedTasks = tasks.filter((t) => t.status === "rejected").length;
  if (failedTasks > 0) {
    signals.push({
      id: "tasks_failed",
      label: `${failedTasks} 个任务未成功完成，建议在任务看板复查`,
      severity: "risk",
    });
    penalty += Math.min(30, failedTasks * 10);
  }

  const matterIds = listMatterIdsFromStorage(workspaceDir);
  let blockedQueueOpen = 0;
  for (const matterId of matterIds) {
    for (const q of readQueueItems(workspaceDir, matterId)) {
      if (q.status !== "open" && q.status !== "in_progress") {
        continue;
      }
      const blocked =
        Boolean(q.blockedReason?.trim()) ||
        (q.blockedBy?.length ?? 0) > 0 ||
        (q.dependsOn?.length ?? 0) > 0;
      if (blocked) {
        blockedQueueOpen += 1;
      }
    }
  }
  if (blockedQueueOpen > 0) {
    signals.push({
      id: "queue_blocked",
      label: `${blockedQueueOpen} 个队列项存在依赖或阻塞原因，请在案件任务看板处理`,
      severity: blockedQueueOpen >= 3 ? "warn" : "info",
    });
    penalty += Math.min(20, blockedQueueOpen * 5);
  }

  const drafts = listDrafts(workspaceDir);
  const pendingReview = drafts.filter((d) => d.reviewStatus === "pending").length;
  if (pendingReview >= 3) {
    signals.push({
      id: "drafts_pending_review",
      label: `${pendingReview} 份草稿待在审核台验收`,
      severity: "info",
    });
    penalty += Math.min(15, (pendingReview - 2) * 3);
  }

  const score = Math.max(0, 100 - penalty);
  const grade: SessionHealthReport["grade"] =
    score >= 80 ? "good" : score >= 50 ? "attention" : "risk";
  const summary =
    grade === "good"
      ? "工作区整体状态良好。"
      : grade === "attention"
        ? "有少量待办或草稿需要关注。"
        : "存在失败任务或多处待处理项，建议先清理再交办新工作。";

  return { score, grade, summary, signals };
}
