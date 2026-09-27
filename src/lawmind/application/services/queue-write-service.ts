/**
 * Work Queue Write Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/queue.jsonl`。
 *
 * 与 read-side `queue-service.ts` 区分：read 从 JSON + 任务/草稿轻量派生（不扫 audit），
 * write 走 service + JSON 真相源；W4 起 engine 落 draft 时调用 `openQueueItem`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendQueueItem,
  readQueueItems,
  rewriteQueueItems,
  type QueueItemRecord,
} from "../../adapters/matter-storage/index.js";
import { matterDir, withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import { attachQueueItemId, createMatterIfMissing } from "./matter-write-service.js";
import { invalidateQueueListSnap } from "./queue-service.js";

function newTimestamp(): string {
  return new Date().toISOString();
}

export type OpenQueueItemInput = {
  matterId: string;
  kind: QueueItemRecord["kind"];
  title: string;
  detail?: string;
  priority?: QueueItemRecord["priority"];
  relatedTaskId?: string;
  relatedDeliverableId?: string;
  queueItemId?: string;
  dependsOn?: string[];
  blockedReason?: string;
};

const QUEUE_STATUSES = ["open", "in_progress", "resolved", "dismissed"] as const;
type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** 合法转移。终态只能 reopen 回 open，不能从已完成直接改成驳回。 */
const QUEUE_TRANSITIONS: Record<QueueStatus, ReadonlySet<QueueStatus>> = {
  open: new Set(["in_progress", "resolved", "dismissed"]),
  in_progress: new Set(["open", "resolved", "dismissed"]),
  resolved: new Set(["open"]),
  dismissed: new Set(["open"]),
};

export function canTransitionQueueStatus(from: QueueStatus, to: QueueStatus): boolean {
  if (from === to) {
    return true;
  }
  return QUEUE_TRANSITIONS[from]?.has(to) ?? false;
}

function unresolvedDeps(items: QueueItemRecord[], dependsOn: string[] | undefined): string[] {
  if (!dependsOn?.length) {
    return [];
  }
  return dependsOn.filter((id) => {
    const dep = items.find((q) => q.queueItemId === id);
    return !dep || (dep.status !== "resolved" && dep.status !== "dismissed");
  });
}

function applyDependencyFields(item: QueueItemRecord, items: QueueItemRecord[]): QueueItemRecord {
  const unresolved = unresolvedDeps(items, item.dependsOn);
  if (!item.dependsOn?.length) {
    return item.blockedBy?.length ? { ...item, blockedBy: undefined } : item;
  }
  if (unresolved.length === 0) {
    const auto = item.blockedReason?.startsWith("等待前置待办：");
    return {
      ...item,
      blockedBy: undefined,
      ...(auto ? { blockedReason: undefined } : {}),
    };
  }
  const auto = !item.blockedReason || item.blockedReason.startsWith("等待前置待办：");
  return {
    ...item,
    blockedBy: unresolved,
    ...(auto ? { blockedReason: `等待前置待办：${unresolved.join(", ")}` } : {}),
  };
}

function refreshDependencyFields(items: QueueItemRecord[]): QueueItemRecord[] {
  return items.map((item) => applyDependencyFields(item, items));
}

function resolveQueueBlockedReason(
  items: QueueItemRecord[],
  dependsOn: string[] | undefined,
  explicit?: string,
): { blockedReason?: string; blockedBy?: string[] } {
  const unresolved = unresolvedDeps(items, dependsOn);
  if (explicit?.trim()) {
    return {
      blockedReason: explicit.trim(),
      ...(unresolved.length > 0 ? { blockedBy: unresolved } : {}),
    };
  }
  if (unresolved.length === 0) {
    return {};
  }
  return {
    blockedReason: `等待前置待办：${unresolved.join(", ")}`,
    blockedBy: unresolved,
  };
}

export function openQueueItem(workspaceDir: string, input: OpenQueueItemInput): QueueItemRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const now = newTimestamp();
  // 依赖判断和 append 必须在同一把锁里，避免刚解析完的前置仍被写成「等待」。
  const lockPath = path.join(matterDir(workspaceDir, input.matterId), "queue.jsonl.lock");
  const record = withExclusiveFileLock(lockPath, () => {
    const existing = readQueueItems(workspaceDir, input.matterId);
    const blocks = resolveQueueBlockedReason(existing, input.dependsOn, input.blockedReason);
    const next: QueueItemRecord = {
      queueItemId: input.queueItemId ?? randomUUID(),
      matterId: input.matterId,
      kind: input.kind,
      status: "open",
      priority: input.priority ?? "normal",
      title: input.title,
      detail: input.detail,
      relatedTaskId: input.relatedTaskId,
      relatedDeliverableId: input.relatedDeliverableId,
      dependsOn: input.dependsOn,
      blockedReason: blocks.blockedReason,
      blockedBy: blocks.blockedBy,
      createdAt: now,
      updatedAt: now,
    };
    appendQueueItem(workspaceDir, next);
    return next;
  });
  invalidateQueueListSnap(workspaceDir);
  attachQueueItemId(workspaceDir, input.matterId, record.queueItemId);
  return record;
}

export function transitionQueueItem(
  workspaceDir: string,
  matterId: string,
  queueItemId: string,
  status: QueueItemRecord["status"],
): QueueItemRecord | undefined {
  const lockPath = path.join(matterDir(workspaceDir, matterId), "queue.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readQueueItems(workspaceDir, matterId);
    const idx = all.findIndex((q) => q.queueItemId === queueItemId);
    if (idx < 0) {
      return undefined;
    }
    const current = all[idx];
    if (!canTransitionQueueStatus(current.status, status)) {
      return undefined;
    }
    if (current.status === status) {
      return current;
    }
    all[idx] = {
      ...current,
      status,
      updatedAt: newTimestamp(),
    };
    const refreshed = refreshDependencyFields(all);
    rewriteQueueItems(workspaceDir, matterId, refreshed);
    invalidateQueueListSnap(workspaceDir);
    return refreshed[idx];
  });
}

export function listQueueItemsForMatter(
  workspaceDir: string,
  matterId: string,
  opts?: { status?: QueueItemRecord["status"]; kind?: QueueItemRecord["kind"] },
): QueueItemRecord[] {
  return readQueueItems(workspaceDir, matterId).filter(
    (q) =>
      (opts?.status ? q.status === opts.status : true) &&
      (opts?.kind ? q.kind === opts.kind : true),
  );
}

export type { QueueItemRecord };
