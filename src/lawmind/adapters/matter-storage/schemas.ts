/**
 * 案件落盘契约的名字兼容层。
 * 字段只定义在 schema.ts。这里保留 matterSchema 等旧名字，避免写侧再长出第二份 zod。
 */

export {
  MATTER_RECORD_SCHEMA_VERSION,
  MatterDocumentSchema,
  MatterRecordSchema as matterSchema,
  DeliverableRecordSchema as deliverableSchema,
  ApprovalRecordSchema as approvalSchema,
  QueueRecordSchema as queueItemSchema,
  DeadlineRecordSchema as deadlineSchema,
  ObligationRecordSchema as obligationSchema,
  ResearchPinSchema,
  type MatterDocumentRecord,
  type MatterRecord,
  type DeliverableRecord,
  type ApprovalRecord,
  type QueueRecord as QueueItemRecord,
  type DeadlineRecord,
  type ObligationRecord,
  type ResearchPin,
} from "./schema.js";
