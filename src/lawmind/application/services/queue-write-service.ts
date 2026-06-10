/**
 * Work Queue Write Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/queue.jsonl`。
 *
 * 与 read-side `queue-service.ts` 区分：read 仍可从 MatterIndex 派生（fallback），
 * write 走 service + JSON 真相源；W4 起 engine 落 draft 时调用 `openQueueItem`。
 */

import { randomUUID } from "node:crypto";
import {
  appendQueueItem,
  readQueueItems,
  rewriteQueueItems,
  type QueueItemRecord,
} from "../../adapters/matter-storage/index.js";
import { attachQueueItemId, createMatterIfMissing } from "./matter-write-service.js";

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

function resolveQueueBlockedReason(
  workspaceDir: string,
  matterId: string,
  dependsOn: string[] | undefined,
  explicit?: string,
): string | undefined {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  if (!dependsOn?.length) {
    return undefined;
  }
  const items = readQueueItems(workspaceDir, matterId);
  const unresolved = dependsOn.filter((id) => {
    const dep = items.find((q) => q.queueItemId === id);
    return !dep || dep.status !== "resolved";
  });
  if (unresolved.length === 0) {
    return undefined;
  }
  return `等待前置待办：${unresolved.join(", ")}`;
}

export function openQueueItem(workspaceDir: string, input: OpenQueueItemInput): QueueItemRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const now = newTimestamp();
  const blockedReason = resolveQueueBlockedReason(
    workspaceDir,
    input.matterId,
    input.dependsOn,
    input.blockedReason,
  );
  const record: QueueItemRecord = {
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
    blockedReason,
    createdAt: now,
    updatedAt: now,
  };
  appendQueueItem(workspaceDir, record);
  attachQueueItemId(workspaceDir, input.matterId, record.queueItemId);
  return record;
}

export function transitionQueueItem(
  workspaceDir: string,
  matterId: string,
  queueItemId: string,
  status: QueueItemRecord["status"],
): QueueItemRecord | undefined {
  const all = readQueueItems(workspaceDir, matterId);
  const idx = all.findIndex((q) => q.queueItemId === queueItemId);
  if (idx < 0) {
    return undefined;
  }
  const next: QueueItemRecord = {
    ...all[idx],
    status,
    updatedAt: newTimestamp(),
  };
  all[idx] = next;
  rewriteQueueItems(workspaceDir, matterId, all);
  return next;
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
