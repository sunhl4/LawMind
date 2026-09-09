/**
 * Matter-scoped timeline from audit + session metadata (read-only).
 */

import fs from "node:fs";
import path from "node:path";
import { readApprovals } from "../adapters/matter-storage/index.js";
import { readAllAuditLogs } from "../audit/index.js";
import { listTaskRecords } from "../tasks/index.js";

export type SessionTimelineEntry = {
  id: string;
  timestamp: string;
  label: string;
  kind: "audit" | "session" | "approval" | "job";
  severity: "info" | "warn";
};

/** 时间线中文状态标签（律师向，不落英文枚举）。 */
const APPROVAL_STATUS_ZH: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  needs_changes: "需修改",
};

const JOB_STATUS_ZH: Record<string, string> = {
  scheduled: "已预约",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted_by_restart: "已中断（应用重启）",
};

const AUDIT_KIND_ZH: Record<string, string> = {
  "task.created": "任务已创建",
  "task.confirmed": "任务已确认",
  "research.started": "检索开始",
  "research.completed": "检索完成",
  "draft.created": "草稿已生成",
  "draft.auto_delivered": "内部低风险已自动交付",
  "draft.reviewed": "草稿已签批",
  "draft.review_reopened": "草稿恢复待审核",
  "draft.review_labeled": "草稿已打标签",
  "draft.revision_dispatched": "后台修订已派发",
  "draft.revision_completed": "后台修订已完成",
  "draft.revision_agent_failed": "后台修订失败",
  "artifact.rendered": "已导出交付物",
  "artifact.render_failed": "导出失败",
  "artifact.render_blocked": "导出被门禁拦截",
  "automation.run_failed": "交办运行失败",
  "memory.adoption_suggested": "记忆建议已入队",
  "memory.adoption_adopted": "记忆建议已采纳",
  "memory.adoption_dismissed": "记忆建议已忽略",
};

function approvalStatusZh(status: string): string {
  return APPROVAL_STATUS_ZH[status] ?? status;
}

function jobStatusZh(status: string): string {
  return JOB_STATUS_ZH[status] ?? status;
}

function auditKindZh(kind: string): string {
  return AUDIT_KIND_ZH[kind] ?? kind;
}

export async function buildMatterSessionTimeline(
  workspaceDir: string,
  matterId: string,
  limit = 40,
): Promise<SessionTimelineEntry[]> {
  const entries: SessionTimelineEntry[] = [];
  const root = path.resolve(workspaceDir);
  const auditDir = path.join(root, "audit");

  const matterTaskIds = new Set(
    listTaskRecords(workspaceDir)
      .filter((t) => t.matterId === matterId)
      .map((t) => t.taskId),
  );

  for (const ev of await readAllAuditLogs(auditDir)) {
    if (!matterTaskIds.has(ev.taskId)) {
      continue;
    }
    entries.push({
      id: ev.eventId,
      timestamp: ev.timestamp,
      label: `${auditKindZh(ev.kind)}${ev.detail ? ` — ${ev.detail.slice(0, 80)}` : ""}`,
      kind: "audit",
      severity: ev.kind.includes("failed") || ev.kind.includes("rejected") ? "warn" : "info",
    });
  }

  const sessionsDir = path.join(root, "sessions");
  try {
    for (const name of fs.readdirSync(sessionsDir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const raw = fs.readFileSync(path.join(sessionsDir, name), "utf8");
      const s = JSON.parse(raw) as { sessionId?: string; matterId?: string; updatedAt?: string };
      if (s.matterId !== matterId) {
        continue;
      }
      entries.push({
        id: s.sessionId ?? name,
        timestamp: s.updatedAt ?? new Date().toISOString(),
        label: `对话 ${s.sessionId ?? name}`,
        kind: "session",
        severity: "info",
      });
    }
  } catch {
    // ignore
  }

  for (const approval of readApprovals(workspaceDir, matterId)) {
    entries.push({
      id: approval.approvalId,
      timestamp: approval.requestedAt,
      label: `审批 ${approvalStatusZh(approval.status)} — ${approval.reason.slice(0, 60)}`,
      kind: "approval",
      severity: approval.status === "pending" ? "warn" : "info",
    });
  }

  const jobsDir = path.join(root, "lawmind", "jobs");
  try {
    for (const name of fs.readdirSync(jobsDir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const raw = fs.readFileSync(path.join(jobsDir, name), "utf8");
      const job = JSON.parse(raw) as {
        jobId?: string;
        matterId?: string;
        status?: string;
        updatedAt?: string;
        createdAt?: string;
      };
      if (job.matterId !== matterId) {
        continue;
      }
      entries.push({
        id: job.jobId ?? name,
        timestamp: job.updatedAt ?? job.createdAt ?? new Date().toISOString(),
        label: `任务 ${jobStatusZh(job.status ?? "unknown")}`,
        kind: "job",
        severity: job.status === "failed" || job.status === "cancelled" ? "warn" : "info",
      });
    }
  } catch {
    // ignore
  }

  return entries.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

/** Alias for Phase 12 unified matter timeline. */
export const buildMatterUnifiedTimeline = buildMatterSessionTimeline;
