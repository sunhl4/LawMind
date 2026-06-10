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
      label: `${ev.kind}${ev.detail ? ` — ${ev.detail.slice(0, 80)}` : ""}`,
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
      label: `审批 ${approval.status} — ${approval.reason.slice(0, 60)}`,
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
        label: `任务 ${job.status ?? "unknown"}`,
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
