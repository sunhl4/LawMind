/**
 * 新材料 / activity feed from replica ops (matter-scoped).
 */

import { listRecordOps } from "./record-ops.js";
import type { MatterRecordOp, MatterReplicaFeedItem } from "./types.js";

const FEED_KINDS = new Set([
  "material.put",
  "material.remove",
  "case_md.snapshot",
  "invite.accept",
  "lock.acquire",
  "lock.release",
]);

function titleFor(op: MatterRecordOp): string {
  const rel =
    typeof op.payload.relPath === "string"
      ? op.payload.relPath
      : typeof op.payload.fileName === "string"
        ? op.payload.fileName
        : "";
  switch (op.kind) {
    case "material.put":
      return rel ? `新材料 · ${rel}` : "新材料";
    case "material.remove":
      return rel ? `移除材料 · ${rel}` : "移除材料";
    case "case_md.snapshot":
      return "案件叙事已更新（CASE.md）";
    case "invite.accept":
      return `${op.actorName} 已加入本案`;
    case "lock.acquire":
      return rel ? `签出 · ${rel}` : "签出材料";
    case "lock.release":
      return rel ? `释放签出 · ${rel}` : "释放签出";
    default:
      return op.kind;
  }
}

export function listMatterReplicaFeed(
  workspaceDir: string,
  matterId: string,
  opts?: { limit?: number },
): MatterReplicaFeedItem[] {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 200);
  const ops = listRecordOps(workspaceDir, matterId)
    .filter((o) => FEED_KINDS.has(o.kind))
    .toReversed()
    .slice(0, limit);

  return ops.map((op) => {
    const relPath = typeof op.payload.relPath === "string" ? op.payload.relPath : undefined;
    const sha256 = typeof op.payload.sha256 === "string" ? op.payload.sha256 : undefined;
    const size = typeof op.payload.size === "number" ? op.payload.size : undefined;
    return {
      opId: op.opId,
      matterId: op.matterId,
      kind: op.kind,
      actorId: op.actorId,
      actorName: op.actorName,
      createdAt: op.createdAt,
      title: titleFor(op),
      relPath,
      sha256,
      size,
    };
  });
}
