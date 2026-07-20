/**
 * zod schemas — `workspace/matters/<id>/` 下的 JSON 真相源（W3）。
 *
 * 这些 schema 是写侧 application services 与磁盘之间的契约。
 * 当前与 src/lawmind/core/contracts.ts 中的 TypeScript 类型一一对应。
 */

import { z } from "zod";

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export const SeveritySchema = z.enum(["soft", "hard", "critical"]);

export const MatterStatusSchema = z.enum([
  "intake",
  "active",
  "waiting_on_client",
  "waiting_on_firm",
  "under_review",
  "delivered",
  "closed",
]);

export const MatterRecordSchema = z.object({
  matterId: z.string().min(1),
  clientId: z.string().optional(),
  title: z.string().min(1),
  status: MatterStatusSchema,
  sensitivity: z.enum(["normal", "high", "restricted"]),
  ownerLawyerId: z.string().optional(),
  primaryAssistantRoleId: z.string().optional(),
  strategyStatus: z.enum(["missing", "draft", "approved", "stale"]),
  openQuestionIds: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  deadlineIds: z.array(z.string()).default([]),
  deliverableIds: z.array(z.string()).default([]),
  queueItemIds: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type MatterRecord = z.infer<typeof MatterRecordSchema>;

export const DeliverableKindSchema = z.enum([
  "legal-memo",
  "contract-review",
  "demand-letter",
  "litigation-outline",
  "client-brief",
  "evidence-timeline",
  "general-document",
]);

export const DeliverableStatusSchema = z.enum([
  "planned",
  "drafting",
  "pending_review",
  "approved",
  "rendered",
  "delivered",
  "learned",
  "blocked",
]);

export const DeliverableRecordSchema = z.object({
  deliverableId: z.string().min(1),
  matterId: z.string().min(1),
  taskId: z.string().optional(),
  kind: DeliverableKindSchema,
  audience: z.enum(["internal", "client", "counterparty", "court", "unknown"]),
  status: DeliverableStatusSchema,
  templateId: z.string().optional(),
  currentDraftTaskId: z.string().optional(),
  currentReviewStatus: z
    .enum(["pending", "approved", "rejected", "modified", "redacted"])
    .optional(),
  ownerLawyerId: z.string().optional(),
  reviewerId: z.string().optional(),
  approvedBy: z.string().optional(),
  deliveredBy: z.string().optional(),
  deliveredAt: z.string().optional(),
  blockingReasons: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeliverableRecord = z.infer<typeof DeliverableRecordSchema>;

export const ApprovalRecordSchema = z.object({
  approvalId: z.string().min(1),
  matterId: z.string().min(1),
  deliverableId: z.string().optional(),
  requestedBy: z.string().min(1),
  requestedRole: z.string().optional(),
  /** W8 起：明确委派的目标角色（即审批应由谁完成） */
  targetRole: z.string().optional(),
  requestedAt: z.string(),
  reason: z.string().min(1),
  riskLevel: RiskLevelSchema,
  status: z.enum(["pending", "approved", "rejected", "needs_changes"]),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const QueueKindSchema = z.enum([
  "need_client_input",
  "need_evidence",
  "need_conflict_check",
  "need_lawyer_review",
  "need_partner_approval",
  "ready_to_draft",
  "ready_to_render",
  "blocked_by_deadline",
  "blocked_by_missing_strategy",
]);

export const QueueRecordSchema = z.object({
  queueItemId: z.string().min(1),
  matterId: z.string().min(1),
  kind: QueueKindSchema,
  status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
  priority: z.enum(["low", "normal", "high", "critical"]),
  title: z.string().min(1),
  detail: z.string().optional(),
  relatedTaskId: z.string().optional(),
  relatedDeliverableId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QueueRecord = z.infer<typeof QueueRecordSchema>;

export const DeadlineRecordSchema = z.object({
  deadlineId: z.string().min(1),
  matterId: z.string().min(1),
  title: z.string().min(1),
  dueAt: z.string(),
  severity: SeveritySchema,
  source: z.enum(["manual", "case_memory", "project_file", "calendar_import"]),
  status: z.enum(["open", "snoozed", "completed", "missed"]),
  notes: z.string().optional(),
});
export type DeadlineRecord = z.infer<typeof DeadlineRecordSchema>;
