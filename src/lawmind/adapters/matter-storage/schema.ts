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

export const MatterKindSchema = z.enum(["contract", "litigation", "general"]);

/** 案件落盘契约版本。旧文件缺这个字段时仍可读，下次保存会写上。 */
export const MATTER_RECORD_SCHEMA_VERSION = 1 as const;

export const MatterPartyRoleSchema = z.enum([
  "client",
  "counterparty",
  "agent",
  "counsel",
  "other",
]);

export const MatterPartyServiceMethodSchema = z.enum([
  "mail",
  "electronic",
  "in_person",
  "unknown",
]);

export const MatterPartySchema = z.object({
  partyId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  role: MatterPartyRoleSchema,
  standing: z.string().trim().max(40).optional(),
  serviceAddress: z.string().trim().max(200).optional(),
  serviceMethod: MatterPartyServiceMethodSchema.optional(),
});
export type MatterParty = z.infer<typeof MatterPartySchema>;

export const MatterDocketSchema = z.object({
  caseNo: z.string().optional(),
  court: z.string().optional(),
  instance: z.string().optional(),
  standing: z.string().optional(),
  hearingAt: z.string().optional(),
  /** 标的金额：自由文本，保留「32,100 元」等原始写法。 */
  claimAmount: z.string().trim().max(120).optional(),
});

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
  matterKind: MatterKindSchema.optional(),
  /** 模型给出的事项名称。matterKind 只做粗筛，不代替这个名字。 */
  matterLabel: z.string().trim().min(1).max(80).optional(),
  practiceTags: z.array(z.string()).optional(),
  schemaVersion: z.literal(MATTER_RECORD_SCHEMA_VERSION).optional(),
  revision: z.number().int().nonnegative().optional(),
  causeOfAction: z.string().trim().max(200).optional(),
  counterparty: z.string().trim().max(200).optional(),
  parties: z.array(MatterPartySchema).max(32).optional(),
  docket: MatterDocketSchema.optional(),
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
  /** 当前草稿在本案文书账上的版本。正文仍在 drafts/。 */
  currentDraftRevision: z.number().int().positive().optional(),
  /** 这份稿引用过的 ResearchSource.id。 */
  citedSourceIds: z.array(z.string().min(1).max(128)).max(64).optional(),
  /** matters/<id>/documents/<documentId>.json */
  documentId: z.string().min(1).max(128).optional(),
  schemaVersion: z.literal(MATTER_RECORD_SCHEMA_VERSION).optional(),
  revision: z.number().int().nonnegative().optional(),
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
  dependsOn: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  blockedReason: z.string().optional(),
  phase: z.enum(["plan", "research", "draft", "review", "render"]).optional(),
  /** 模型命名的待办。kind 里的流程阶段只为兼容旧行。 */
  label: z.string().trim().min(1).max(80).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QueueRecord = z.infer<typeof QueueRecordSchema>;

export const MatterDocumentSchema = z.object({
  documentId: z.string().min(1).max(128),
  matterId: z.string().min(1),
  relativePath: z.string().trim().min(1).max(512),
  version: z.number().int().positive(),
  contentHash: z.string().trim().min(8).max(128).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  updatedAt: z.string(),
});
export type MatterDocumentRecord = z.infer<typeof MatterDocumentSchema>;

export const DeadlineRecordSchema = z.object({
  deadlineId: z.string().min(1),
  matterId: z.string().min(1),
  title: z.string().min(1),
  dueAt: z.string(),
  severity: SeveritySchema,
  source: z.enum(["manual", "case_memory", "project_file", "calendar_import", "document_extract"]),
  status: z.enum(["open", "snoozed", "completed", "missed"]),
  notes: z.string().optional(),
  eventKind: z
    .enum(["hearing", "filing", "limitation", "reply", "preservation", "custom"])
    .optional(),
  remindBeforeHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .optional(),
  icsUid: z.string().optional(),
  remindedAt: z.string().optional(),
  dependsOnDeadlineId: z.string().min(1).max(64).optional(),
});
export type DeadlineRecord = z.infer<typeof DeadlineRecordSchema>;

export const ObligationStatusSchema = z.enum(["open", "done", "waived"]);

/** 付款、通知、履约。金额保留原文；能读成元才记分，读不出仍保存。 */
export const ObligationRecordSchema = z.object({
  obligationId: z.string().min(1).max(64),
  matterId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  obligor: z.string().trim().min(1).max(120).optional(),
  amountText: z.string().trim().min(1).max(120).optional(),
  amountMinor: z.number().int().nonnegative().optional(),
  dueAt: z.string().optional(),
  deadlineId: z.string().min(1).max(64).optional(),
  sourceQuote: z.string().trim().min(1).max(240).optional(),
  status: ObligationStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ObligationRecord = z.infer<typeof ObligationRecordSchema>;

/** 结论上的定位。条、款、页或原文片段，至少填一项才算钉住出处。 */
export const ResearchPinSchema = z
  .object({
    article: z.string().trim().min(1).max(80).optional(),
    clause: z.string().trim().min(1).max(80).optional(),
    page: z.string().trim().min(1).max(40).optional(),
    quote: z.string().trim().min(1).max(240).optional(),
  })
  .refine((pin) => Boolean(pin.article || pin.clause || pin.page || pin.quote), {
    message: "research pin needs article, clause, page, or quote",
  });
export type ResearchPin = z.infer<typeof ResearchPinSchema>;
