/**
 * Matter 真相源 zod schemas — 与 src/lawmind/core/contracts.ts 类型保持一致。
 *
 * 写侧 service 在落盘前用这些 schema 校验，错误走 audit `deliverable.spec.invalid`
 * 类似事件。读侧返回前也建议用 `safeParse` 防御坏 JSON。
 */

import { z } from "zod";

export const matterSchema = z.object({
  matterId: z.string().min(1),
  clientId: z.string().optional(),
  title: z.string().min(1),
  status: z.enum([
    "intake",
    "active",
    "waiting_on_client",
    "waiting_on_firm",
    "under_review",
    "delivered",
    "closed",
  ]),
  sensitivity: z.enum(["normal", "high", "restricted"]),
  ownerLawyerId: z.string().optional(),
  primaryAssistantRoleId: z.string().optional(),
  strategyStatus: z.enum(["missing", "draft", "approved", "stale"]),
  openQuestionIds: z.array(z.string()),
  nextActions: z.array(z.string()),
  deadlineIds: z.array(z.string()),
  deliverableIds: z.array(z.string()),
  queueItemIds: z.array(z.string()),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const deliverableSchema = z.object({
  deliverableId: z.string().min(1),
  matterId: z.string().min(1),
  taskId: z.string().optional(),
  kind: z.enum([
    "legal-memo",
    "contract-review",
    "demand-letter",
    "litigation-outline",
    "client-brief",
    "evidence-timeline",
    "general-document",
  ]),
  audience: z.enum(["internal", "client", "counterparty", "court", "unknown"]),
  status: z.enum(["planned", "drafting", "pending_review", "approved", "rendered", "blocked"]),
  templateId: z.string().optional(),
  currentDraftTaskId: z.string().optional(),
  currentReviewStatus: z.enum(["pending", "approved", "rejected", "modified"]).optional(),
  blockingReasons: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const approvalSchema = z.object({
  approvalId: z.string().min(1),
  matterId: z.string().min(1),
  deliverableId: z.string().optional(),
  requestedBy: z.string().min(1),
  requestedRole: z.string().optional(),
  /** W8 will start populating this with target Role.roleId */
  targetRole: z.string().optional(),
  requestedAt: z.string().min(1),
  reason: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["pending", "approved", "rejected", "needs_changes"]),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
});

export const queueItemSchema = z.object({
  queueItemId: z.string().min(1),
  matterId: z.string().min(1),
  kind: z.enum([
    "need_client_input",
    "need_evidence",
    "need_conflict_check",
    "need_lawyer_review",
    "need_partner_approval",
    "ready_to_draft",
    "ready_to_render",
    "blocked_by_deadline",
    "blocked_by_missing_strategy",
  ]),
  status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
  priority: z.enum(["low", "normal", "high", "critical"]),
  title: z.string().min(1),
  detail: z.string().optional(),
  relatedTaskId: z.string().optional(),
  relatedDeliverableId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  blockedReason: z.string().optional(),
  phase: z.enum(["plan", "research", "draft", "review", "render"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deadlineSchema = z.object({
  deadlineId: z.string().min(1),
  matterId: z.string().min(1),
  title: z.string().min(1),
  dueAt: z.string().min(1),
  severity: z.enum(["soft", "hard", "critical"]),
  source: z.enum(["manual", "case_memory", "project_file", "calendar_import"]),
  status: z.enum(["open", "snoozed", "completed", "missed"]),
  notes: z.string().optional(),
});

export type MatterRecord = z.infer<typeof matterSchema>;
export type DeliverableRecord = z.infer<typeof deliverableSchema>;
export type ApprovalRecord = z.infer<typeof approvalSchema>;
export type QueueItemRecord = z.infer<typeof queueItemSchema>;
export type DeadlineRecord = z.infer<typeof deadlineSchema>;
