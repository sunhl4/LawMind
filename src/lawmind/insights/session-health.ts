/**
 * Workspace-level session health — lightweight signals for Doctor / Matter UI.
 */

import { listMatterIdsFromStorage, readQueueItems } from "../adapters/matter-storage/index.js";
import { listSessions } from "../agent/session.js";
import { listDrafts } from "../drafts/index.js";
import { listPendingToolApprovals } from "../platform/pending-tool-approvals.js";
import { listTaskRecords } from "../tasks/index.js";
import {
  SESSION_INTEGRITY_SCAN_LIMIT,
  scanSessionHistoryIntegrity,
} from "./session-history-integrity.js";

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
      label: `${toolApprovals.length} 个操作待你批准。请到「待我拍板」处理。`,
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

  const tasks = listTaskRecords(workspaceDir);
  const failedTasks = tasks.filter((t) => t.status === "rejected").length;
  if (failedTasks > 0) {
    signals.push({
      id: "tasks_failed",
      label: `${failedTasks} 个任务没有完成。请到「在办」复查。`,
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
      label: `${blockedQueueOpen} 项工作被堵住。请在案件里处理。`,
      severity: blockedQueueOpen >= 3 ? "warn" : "info",
    });
    penalty += Math.min(20, blockedQueueOpen * 5);
  }

  const drafts = listDrafts(workspaceDir);
  const pendingReview = drafts.filter((d) => d.reviewStatus === "pending").length;
  if (pendingReview >= 3) {
    signals.push({
      id: "drafts_pending_review",
      label: `${pendingReview} 份草稿待你验收。请到「在办」查看。`,
      severity: "info",
    });
    penalty += Math.min(15, (pendingReview - 2) * 3);
  }

  // 会话历史损坏：坏历史会每轮重放 400，律师看到的是「模型调用失败」而非本因。
  const integrity = scanSessionHistoryIntegrity(workspaceDir, {
    maxSessions: SESSION_INTEGRITY_SCAN_LIMIT,
  });
  if (!integrity.ok) {
    signals.push({
      id: "session_history_corrupt",
      label: `${integrity.corruptSessionCount} 个会话的工具调用没有配对好。下一轮对话会自动补上。`,
      severity: "risk",
    });
    penalty += Math.min(30, integrity.corruptSessionCount * 10);
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
