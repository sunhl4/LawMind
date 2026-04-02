import { buildMatterIndex, listMatterIds } from "../../cases/index.js";
import {
  buildApprovalRequestsFromMatterIndex,
  buildQueueItemsFromMatterIndex,
  type ApprovalRequest,
  type WorkQueueItem,
} from "../../core/contracts.js";

export async function listApprovalRequests(
  workspaceDir: string,
  opts?: { matterId?: string; status?: ApprovalRequest["status"] },
): Promise<ApprovalRequest[]> {
  const matterIds = opts?.matterId ? [opts.matterId] : await listMatterIds(workspaceDir);
  const indexes = await Promise.all(
    matterIds.map((matterId) => buildMatterIndex(workspaceDir, matterId)),
  );
  const approvals = indexes.flatMap((index) => buildApprovalRequestsFromMatterIndex(index));
  return approvals
    .filter((item) => (opts?.status ? item.status === opts.status : true))
    .toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function listWorkQueueItems(
  workspaceDir: string,
  opts?: { matterId?: string; kind?: WorkQueueItem["kind"] },
): Promise<WorkQueueItem[]> {
  const matterIds = opts?.matterId ? [opts.matterId] : await listMatterIds(workspaceDir);
  const indexes = await Promise.all(
    matterIds.map((matterId) => buildMatterIndex(workspaceDir, matterId)),
  );
  const items = indexes.flatMap((index) => buildQueueItemsFromMatterIndex(index));
  return items
    .filter((item) => (opts?.kind ? item.kind === opts.kind : true))
    .toSorted((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (byPriority !== 0) {
        return byPriority;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
