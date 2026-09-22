/**
 * Work Queue / Approval read service — W3/W4。
 *
 * 读取顺序：
 *   1. JSON 真相源（workspace/matters/<id>/queue.jsonl / approvals.jsonl），若有则优先返回。
 *   2. 历史 MatterIndex 派生（向后兼容；无 JSON 真相源的旧工作区仍可用）。
 *
 * 注：W12 季末验收脚本可关闭 fallback 跑通端到端 demo。
 */

import {
  listMatterIdsFromStorage,
  readApprovals,
  readQueueItems,
} from "../../adapters/matter-storage/index.js";
import { buildMatterIndex, listMatterIds } from "../../cases/index.js";
import {
  buildApprovalRequestsFromMatterIndex,
  buildQueueItemsFromMatterIndex,
  type ApprovalRequest,
  type WorkQueueItem,
} from "../../core/contracts.js";

async function unifiedMatterIds(workspaceDir: string): Promise<string[]> {
  const fromStorage = listMatterIdsFromStorage(workspaceDir);
  const fromIndex = await listMatterIds(workspaceDir);
  return Array.from(new Set([...fromStorage, ...fromIndex]));
}

async function approvalsForMatter(
  workspaceDir: string,
  matterId: string,
): Promise<ApprovalRequest[]> {
  const stored = readApprovals(workspaceDir, matterId);
  const index = await buildMatterIndex(workspaceDir, matterId);
  const derived = buildApprovalRequestsFromMatterIndex(index);
  return mergeUniqueById(stored, derived, (a) => a.approvalId);
}

async function queueForMatter(workspaceDir: string, matterId: string): Promise<WorkQueueItem[]> {
  const stored = readQueueItems(workspaceDir, matterId);
  const index = await buildMatterIndex(workspaceDir, matterId);
  const derived = buildQueueItemsFromMatterIndex(index);
  return mergeUniqueById(stored, derived, (q) => q.queueItemId);
}

/** 真相源优先：JSON 写侧 service 写入的条目永远覆盖派生条目；剩余派生条目按 id 补齐。 */
function mergeUniqueById<T>(primary: T[], secondary: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of primary) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  for (const item of secondary) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export async function listApprovalRequests(
  workspaceDir: string,
  opts?: { matterId?: string; status?: ApprovalRequest["status"]; targetRole?: string },
): Promise<ApprovalRequest[]> {
  const matterIds = opts?.matterId ? [opts.matterId] : await unifiedMatterIds(workspaceDir);
  const all = (
    await Promise.all(matterIds.map((id) => approvalsForMatter(workspaceDir, id)))
  ).flat();
  return all
    .filter((item) => (opts?.status ? item.status === opts.status : true))
    .filter((item) => (opts?.targetRole ? item.targetRole === opts.targetRole : true))
    .toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function listWorkQueueItems(
  workspaceDir: string,
  opts?: {
    matterId?: string;
    kind?: WorkQueueItem["kind"];
    status?: WorkQueueItem["status"];
  },
): Promise<WorkQueueItem[]> {
  const matterIds = opts?.matterId ? [opts.matterId] : await unifiedMatterIds(workspaceDir);
  const all = (await Promise.all(matterIds.map((id) => queueForMatter(workspaceDir, id)))).flat();
  return all
    .filter((item) => (opts?.kind ? item.kind === opts.kind : true))
    .filter((item) => (opts?.status ? item.status === opts.status : true))
    .toSorted((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (byPriority !== 0) {
        return byPriority;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
