/**
 * Matter Storage Adapter — JSON / JSONL 真相源的统一入口（W3）。
 *
 * 这一层把 zod schema、文件 IO、原子写组合成单一调用点，对外暴露
 * `loadMatter / saveMatter / appendApproval / appendQueueItem / readQueueItems`
 * 等若干小函数，供 application services 调用。
 *
 * 设计目标：
 *   - service 层完全不直接 touch fs；所有 fs 调用集中在 storage adapter。
 *   - 便于 W12 把真相源换到 SQLite / DuckDB（仅替换本目录实现，不动 service）。
 */

import fs from "node:fs";
import path from "node:path";
import {
  appendJsonl,
  ensureDeliverablesDir,
  ensureMatterDir,
  matterDir,
  readJsonl,
  readJsonValidated,
  rewriteJsonl,
  writeJsonAtomic,
} from "./io.js";
import {
  approvalSchema,
  deadlineSchema,
  deliverableSchema,
  matterSchema,
  queueItemSchema,
  type ApprovalRecord,
  type DeadlineRecord,
  type DeliverableRecord,
  type MatterRecord,
  type QueueItemRecord,
} from "./schemas.js";

export {
  approvalSchema,
  deadlineSchema,
  deliverableSchema,
  matterSchema,
  queueItemSchema,
  type ApprovalRecord,
  type DeadlineRecord,
  type DeliverableRecord,
  type MatterRecord,
  type QueueItemRecord,
};
export { ensureMatterDir, matterDir, mattersRoot, listMatterIdsFromStorage } from "./io.js";

function matterFile(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "matter.json");
}

function deliverableFile(workspaceDir: string, matterId: string, deliverableId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "deliverables", `${deliverableId}.json`);
}

function approvalsFile(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "approvals.jsonl");
}

function queueFile(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "queue.jsonl");
}

function deadlinesFile(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl");
}

// ─────────────────────────────────────────────
// Matter
// ─────────────────────────────────────────────

export function loadMatter(workspaceDir: string, matterId: string): MatterRecord | undefined {
  return readJsonValidated(matterFile(workspaceDir, matterId), matterSchema);
}

export function saveMatter(workspaceDir: string, matter: MatterRecord): MatterRecord {
  matterSchema.parse(matter);
  ensureMatterDir(workspaceDir, matter.matterId);
  writeJsonAtomic(matterFile(workspaceDir, matter.matterId), matter);
  return matter;
}

// ─────────────────────────────────────────────
// Deliverable
// ─────────────────────────────────────────────

export function loadDeliverable(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
): DeliverableRecord | undefined {
  return readJsonValidated(
    deliverableFile(workspaceDir, matterId, deliverableId),
    deliverableSchema,
  );
}

export function saveDeliverable(
  workspaceDir: string,
  deliverable: DeliverableRecord,
): DeliverableRecord {
  deliverableSchema.parse(deliverable);
  ensureDeliverablesDir(workspaceDir, deliverable.matterId);
  writeJsonAtomic(
    deliverableFile(workspaceDir, deliverable.matterId, deliverable.deliverableId),
    deliverable,
  );
  return deliverable;
}

export function listDeliverablesForMatter(
  workspaceDir: string,
  matterId: string,
): DeliverableRecord[] {
  const dir = path.join(matterDir(workspaceDir, matterId), "deliverables");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: DeliverableRecord[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const item = readJsonValidated(path.join(dir, entry.name), deliverableSchema);
    if (item) {
      out.push(item);
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Approval
// ─────────────────────────────────────────────

export function appendApproval(workspaceDir: string, approval: ApprovalRecord): ApprovalRecord {
  ensureMatterDir(workspaceDir, approval.matterId);
  appendJsonl(approvalsFile(workspaceDir, approval.matterId), approvalSchema, approval);
  return approval;
}

export function readApprovals(workspaceDir: string, matterId: string): ApprovalRecord[] {
  return readJsonl(approvalsFile(workspaceDir, matterId), approvalSchema);
}

export function rewriteApprovals(
  workspaceDir: string,
  matterId: string,
  values: ApprovalRecord[],
): void {
  ensureMatterDir(workspaceDir, matterId);
  rewriteJsonl(approvalsFile(workspaceDir, matterId), approvalSchema, values);
}

// ─────────────────────────────────────────────
// Work Queue
// ─────────────────────────────────────────────

export function appendQueueItem(workspaceDir: string, item: QueueItemRecord): QueueItemRecord {
  ensureMatterDir(workspaceDir, item.matterId);
  appendJsonl(queueFile(workspaceDir, item.matterId), queueItemSchema, item);
  return item;
}

export function readQueueItems(workspaceDir: string, matterId: string): QueueItemRecord[] {
  return readJsonl(queueFile(workspaceDir, matterId), queueItemSchema);
}

export function rewriteQueueItems(
  workspaceDir: string,
  matterId: string,
  values: QueueItemRecord[],
): void {
  ensureMatterDir(workspaceDir, matterId);
  rewriteJsonl(queueFile(workspaceDir, matterId), queueItemSchema, values);
}

// ─────────────────────────────────────────────
// Deadlines
// ─────────────────────────────────────────────

export function appendDeadline(workspaceDir: string, deadline: DeadlineRecord): DeadlineRecord {
  ensureMatterDir(workspaceDir, deadline.matterId);
  appendJsonl(deadlinesFile(workspaceDir, deadline.matterId), deadlineSchema, deadline);
  return deadline;
}

export function readDeadlines(workspaceDir: string, matterId: string): DeadlineRecord[] {
  return readJsonl(deadlinesFile(workspaceDir, matterId), deadlineSchema);
}

export function rewriteDeadlines(
  workspaceDir: string,
  matterId: string,
  values: DeadlineRecord[],
): void {
  ensureMatterDir(workspaceDir, matterId);
  rewriteJsonl(deadlinesFile(workspaceDir, matterId), deadlineSchema, values);
}
