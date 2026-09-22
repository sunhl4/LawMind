/**
 * Workspace-wide「新材料」feed for the lawyer desk (Firm-gated caller).
 */

import { listMatterIdsFromStorage } from "../adapters/matter-storage/index.js";
import { listMatterReplicaFeed } from "./feed.js";
import { readMembership } from "./membership.js";
import type { MatterReplicaFeedItem } from "./types.js";

export type DeskReplicaFeedItem = MatterReplicaFeedItem & {
  matterTitle?: string;
};

/**
 * Aggregate recent material.put / invite.accept across matters that have a replica.
 */
export function listDeskReplicaFeed(
  workspaceDir: string,
  opts?: { limit?: number },
): DeskReplicaFeedItem[] {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const items: DeskReplicaFeedItem[] = [];
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    const membership = readMembership(workspaceDir, matterId);
    if (!membership) {
      continue;
    }
    const feed = listMatterReplicaFeed(workspaceDir, matterId, { limit: 12 });
    for (const row of feed) {
      if (
        row.kind !== "material.put" &&
        row.kind !== "invite.accept" &&
        row.kind !== "material.remove"
      ) {
        continue;
      }
      items.push({
        ...row,
        matterTitle: membership.matterTitle,
      });
    }
  }
  return items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
