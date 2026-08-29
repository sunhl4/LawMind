/**
 * Deadline Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/deadlines.jsonl`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendDeadline,
  readDeadlines,
  rewriteDeadlines,
  type DeadlineRecord,
} from "../../adapters/matter-storage/index.js";
import { matterDir, withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import { attachDeadlineId, createMatterIfMissing } from "./matter-write-service.js";

export type RecordDeadlineInput = {
  matterId: string;
  title: string;
  dueAt: string;
  severity?: DeadlineRecord["severity"];
  source?: DeadlineRecord["source"];
  notes?: string;
  deadlineId?: string;
};

export function recordDeadline(workspaceDir: string, input: RecordDeadlineInput): DeadlineRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const record: DeadlineRecord = {
    deadlineId: input.deadlineId ?? randomUUID(),
    matterId: input.matterId,
    title: input.title,
    dueAt: input.dueAt,
    severity: input.severity ?? "soft",
    source: input.source ?? "manual",
    status: "open",
    notes: input.notes,
  };
  // append 与 updateDeadlineStatus 的全量 rewrite 共用同一把锁，避免并发「新建 + 更新」丢条目。
  const lockPath = path.join(matterDir(workspaceDir, input.matterId), "deadlines.jsonl.lock");
  withExclusiveFileLock(lockPath, () => {
    appendDeadline(workspaceDir, record);
  });
  attachDeadlineId(workspaceDir, input.matterId, record.deadlineId);
  return record;
}

export function snoozeDeadline(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
  newDueAt?: string,
): DeadlineRecord | undefined {
  return updateDeadlineStatus(workspaceDir, matterId, deadlineId, "snoozed", { dueAt: newDueAt });
}

export function completeDeadline(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
): DeadlineRecord | undefined {
  return updateDeadlineStatus(workspaceDir, matterId, deadlineId, "completed");
}

export function listDeadlinesForMatter(workspaceDir: string, matterId: string): DeadlineRecord[] {
  return readDeadlines(workspaceDir, matterId);
}

function updateDeadlineStatus(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
  status: DeadlineRecord["status"],
  opts?: { dueAt?: string },
): DeadlineRecord | undefined {
  const lockPath = path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readDeadlines(workspaceDir, matterId);
    const idx = all.findIndex((d) => d.deadlineId === deadlineId);
    if (idx < 0) {
      return undefined;
    }
    const next: DeadlineRecord = {
      ...all[idx],
      status,
      dueAt: opts?.dueAt ?? all[idx].dueAt,
    };
    all[idx] = next;
    rewriteDeadlines(workspaceDir, matterId, all);
    return next;
  });
}

export type { DeadlineRecord };
