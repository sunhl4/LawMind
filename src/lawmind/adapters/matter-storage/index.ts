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
  MATTER_RECORD_SCHEMA_VERSION,
  MatterDocumentSchema,
  approvalSchema,
  deadlineSchema,
  obligationSchema,
  deliverableSchema,
  matterSchema,
  queueItemSchema,
  type ApprovalRecord,
  type DeadlineRecord,
  type ObligationRecord,
  type DeliverableRecord,
  type MatterDocumentRecord,
  type MatterRecord,
  type QueueItemRecord,
} from "./schemas.js";

export {
  approvalSchema,
  deadlineSchema,
  obligationSchema,
  deliverableSchema,
  matterSchema,
  queueItemSchema,
  type ApprovalRecord,
  type DeadlineRecord,
  type ObligationRecord,
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

function obligationsFile(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "obligations.jsonl");
}

// ─────────────────────────────────────────────
// Matter
// ─────────────────────────────────────────────

function childIndexIds(
  workspaceDir: string,
  matterId: string,
): Pick<MatterRecord, "deliverableIds" | "queueItemIds" | "deadlineIds"> {
  return {
    deliverableIds: listDeliverablesForMatter(workspaceDir, matterId).map(
      (row) => row.deliverableId,
    ),
    queueItemIds: readQueueItems(workspaceDir, matterId).map((row) => row.queueItemId),
    deadlineIds: readDeadlines(workspaceDir, matterId).map((row) => row.deadlineId),
  };
}

export function loadMatter(workspaceDir: string, matterId: string): MatterRecord | undefined {
  const record = readJsonValidated(matterFile(workspaceDir, matterId), matterSchema);
  if (!record) {
    return undefined;
  }
  // 这三个数组是子文件的读时汇总。matter.json 里的副本不是真相。
  return { ...record, ...childIndexIds(workspaceDir, matterId) };
}

export function saveMatter(workspaceDir: string, matter: MatterRecord): MatterRecord {
  const stamped = matterSchema.parse({
    ...matter,
    schemaVersion: MATTER_RECORD_SCHEMA_VERSION,
    revision: (matter.revision ?? 0) + 1,
  });
  ensureMatterDir(workspaceDir, stamped.matterId);
  const projected = { ...stamped, ...childIndexIds(workspaceDir, stamped.matterId) };
  writeJsonAtomic(matterFile(workspaceDir, projected.matterId), projected);
  return projected;
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
  const stamped = deliverableSchema.parse({
    ...deliverable,
    schemaVersion: MATTER_RECORD_SCHEMA_VERSION,
    revision: (deliverable.revision ?? 0) + 1,
  });
  ensureDeliverablesDir(workspaceDir, stamped.matterId);
  writeJsonAtomic(deliverableFile(workspaceDir, stamped.matterId, stamped.deliverableId), stamped);
  return stamped;
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

export function appendObligation(
  workspaceDir: string,
  obligation: ObligationRecord,
): ObligationRecord {
  ensureMatterDir(workspaceDir, obligation.matterId);
  appendJsonl(obligationsFile(workspaceDir, obligation.matterId), obligationSchema, obligation);
  return obligation;
}

export function readObligations(workspaceDir: string, matterId: string): ObligationRecord[] {
  return readJsonl(obligationsFile(workspaceDir, matterId), obligationSchema);
}

export function rewriteObligations(
  workspaceDir: string,
  matterId: string,
  values: ObligationRecord[],
): void {
  ensureMatterDir(workspaceDir, matterId);
  rewriteJsonl(obligationsFile(workspaceDir, matterId), obligationSchema, values);
}

function documentsDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "documents");
}

function documentFile(workspaceDir: string, matterId: string, documentId: string): string {
  return path.join(documentsDir(workspaceDir, matterId), `${documentId}.json`);
}

export function loadMatterDocument(
  workspaceDir: string,
  matterId: string,
  documentId: string,
): MatterDocumentRecord | undefined {
  return readJsonValidated(documentFile(workspaceDir, matterId, documentId), MatterDocumentSchema);
}

export function saveMatterDocument(
  workspaceDir: string,
  document: MatterDocumentRecord,
): MatterDocumentRecord {
  const parsed = MatterDocumentSchema.parse(document);
  ensureMatterDir(workspaceDir, parsed.matterId);
  fs.mkdirSync(documentsDir(workspaceDir, parsed.matterId), { recursive: true });
  writeJsonAtomic(documentFile(workspaceDir, parsed.matterId, parsed.documentId), parsed);
  return parsed;
}
