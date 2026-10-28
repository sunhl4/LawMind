/**
 * 统一收件库的落盘契约：`<workspace>/lawmind/intake/`。
 *
 * 所有外部来件（收案邮箱、投递口、以后的录音与企业微信）先成为一条 IntakeItem，
 * 再由判案决定归到哪个案件。来件内容一律不可信：只当数据，不当指令。
 */

import { z } from "zod";

export const IntakeChannelSchema = z.enum(["email", "dropzone", "upload", "wecom", "recording"]);
export type IntakeChannel = z.infer<typeof IntakeChannelSchema>;

/**
 * 判案线索。thread / case_no / matter_ref / verified_contact 是强键：
 * 只有恰好一个案件命中强键、且没有别的案件也命中强键时，系统才自动归档。
 */
export const IntakeKeyKindSchema = z.enum([
  "thread",
  "case_no",
  "matter_ref",
  "verified_contact",
  "contact",
  "party_name",
]);
export type IntakeKeyKind = z.infer<typeof IntakeKeyKindSchema>;

export const STRONG_INTAKE_KEY_KINDS: ReadonlySet<IntakeKeyKind> = new Set([
  "thread",
  "case_no",
  "matter_ref",
  "verified_contact",
]);

export const IntakeKeySchema = z.object({
  kind: IntakeKeyKindSchema,
  matterId: z.string().min(1),
  detail: z.string().max(200),
});
export type IntakeKey = z.infer<typeof IntakeKeySchema>;

export const IntakeCandidateSchema = z.object({
  matterId: z.string().min(1),
  title: z.string().max(200).optional(),
  /** 各线索 log2(m/u) 之和，只用来排序候选，不用来放行自动归档。 */
  score: z.number(),
  strong: z.boolean(),
  keys: z.array(IntakeKeySchema).max(12),
});
export type IntakeCandidate = z.infer<typeof IntakeCandidateSchema>;

export const IntakeDecisionSchema = z.enum(["auto_attach", "propose", "unmatched"]);
export type IntakeDecision = z.infer<typeof IntakeDecisionSchema>;

export const IntakeResolutionSchema = z.object({
  decision: IntakeDecisionSchema,
  candidates: z.array(IntakeCandidateSchema).max(8),
  resolvedAt: z.string(),
});
export type IntakeResolution = z.infer<typeof IntakeResolutionSchema>;

export const IntakeFilingSchema = z.object({
  matterId: z.string().min(1),
  by: z.enum(["system", "lawyer"]),
  at: z.string(),
  keys: z.array(IntakeKeySchema).max(12),
  /** 物化进案件目录的文件（相对工作区）。撤回归档时据此清理。 */
  materialized: z.array(z.string().max(1024)).max(80),
});
export type IntakeFiling = z.infer<typeof IntakeFilingSchema>;

export const IntakeAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  size: z.number().int().nonnegative(),
  contentType: z.string().max(200).optional(),
  skippedReason: z.enum(["type_not_persisted", "too_large", "too_large_total"]).optional(),
});
export type IntakeAttachment = z.infer<typeof IntakeAttachmentSchema>;

export const IntakeThreadSchema = z.object({
  messageId: z.string().max(998).optional(),
  inReplyTo: z.array(z.string().max(998)).max(20).optional(),
  references: z.array(z.string().max(998)).max(50).optional(),
  conversationId: z.string().max(512).optional(),
});
export type IntakeThread = z.infer<typeof IntakeThreadSchema>;

/**
 * 录音转写的分段。ASR 端点给秒时由 `recording.ts` 换算成毫秒；
 * 没有时间戳的端点只给整段文字，此时不写 segments。
 */
export const IntakeTranscriptSegmentSchema = z.object({
  startMs: z.number().finite().nonnegative().optional(),
  endMs: z.number().finite().nonnegative().optional(),
  /** 说话人键（ASR 原样给，如 S1 / speaker_0）；展示名放在 speakerLabels。 */
  speaker: z.string().max(40).optional(),
  text: z.string().max(4000),
  /** 律师改正过这一段的时间；没改过就是 ASR 原文。 */
  editedAt: z.string().optional(),
});
export type IntakeTranscriptSegment = z.infer<typeof IntakeTranscriptSegmentSchema>;

export const IntakeTranscriptSchema = z.object({
  segments: z.array(IntakeTranscriptSegmentSchema).max(2000),
  /** 说话人键 → 律师可读的名字（可映射到当事人）。 */
  speakerLabels: z.record(z.string().max(40), z.string().max(40)).optional(),
  /** 说话人键 → 某案的当事人；案件上下文一起存，换案不会误认。 */
  speakerParties: z
    .record(
      z.string().max(40),
      z.object({ matterId: z.string().max(128), partyId: z.string().max(64) }),
    )
    .optional(),
  /** 律师改过分段文字的时间；没改过就是自动转写原文。 */
  editedAt: z.string().optional(),
});
export type IntakeTranscript = z.infer<typeof IntakeTranscriptSchema>;

export const IntakeStatusSchema = z.enum(["pending", "attached", "ignored"]);
export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;

/**
 * 新案线索：没有任何可靠案件候选的来件，先成为线索，再由律师推进。
 *
 * 只能由律师从 `new` 往前走；`accepted` 只创建 `intake` 状态的案件（收案闸门在 P1），
 * 系统不会因为「看起来像新案」自己接受委托，也不会把线索直接变成 `active` 案件。
 */
export const IntakeLeadStageSchema = z.enum([
  "new",
  "needs_info",
  "conflict_pending",
  "declined",
  "accepted",
]);
export type IntakeLeadStage = z.infer<typeof IntakeLeadStageSchema>;

export const IntakeLeadSchema = z.object({
  stage: IntakeLeadStageSchema,
  at: z.string(),
  by: z.enum(["system", "lawyer"]),
  /** 进入收案后创建的案件；只可能是 `intake` 状态的案件。 */
  matterId: z.string().max(128).optional(),
  note: z.string().max(500).optional(),
});
export type IntakeLead = z.infer<typeof IntakeLeadSchema>;

export const INTAKE_ITEM_ID_RE = /^it-[a-z0-9]{8,40}$/;

export const IntakeItemSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(INTAKE_ITEM_ID_RE),
  channel: IntakeChannelSchema,
  /** 渠道内的去重键：同一封信 / 同一个文件反复同步只记一次。 */
  externalKey: z.string().min(1).max(512),
  trust: z.literal("untrusted"),
  receivedAt: z.string(),
  recordedAt: z.string(),
  from: z
    .object({
      display: z.string().max(320),
      address: z.string().max(254).optional(),
    })
    .optional(),
  to: z.string().max(2000).optional(),
  subject: z.string().max(500).optional(),
  /** 判案与预览用的正文；超长时截断，全文在 bodySha256 指向的原件里。 */
  text: z.string().max(20_000),
  /** 录音分段与说话人展示名；只有录音转写成功且端点给了分段时才有。 */
  transcript: IntakeTranscriptSchema.optional(),
  bodySha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  thread: IntakeThreadSchema.optional(),
  /** 邮件服务商给出的发件域认证结果；fail 时已核验联系人也不算强键。 */
  dmarc: z.enum(["pass", "fail"]).optional(),
  attachments: z.array(IntakeAttachmentSchema).max(50),
  source: z
    .object({
      accountId: z.string().max(80).optional(),
      providerMessageId: z.string().max(1024).optional(),
      dropzoneRelPath: z.string().max(1024).optional(),
    })
    .optional(),
  status: IntakeStatusSchema,
  resolution: IntakeResolutionSchema.optional(),
  /** 新案线索：只有律师把它当新案时才有。 */
  lead: IntakeLeadSchema.optional(),
  filing: IntakeFilingSchema.optional(),
  ignoredAt: z.string().optional(),
});
export type IntakeItem = z.infer<typeof IntakeItemSchema>;

export const IntakeEventSchema = z.object({
  at: z.string(),
  itemId: z.string(),
  kind: z.enum([
    "recorded",
    "resolved",
    "attached",
    "detached",
    "ignored",
    "restored",
    "lead",
    "transcribed",
  ]),
  by: z.enum(["system", "lawyer"]),
  matterId: z.string().optional(),
  detail: z.string().max(500).optional(),
});
export type IntakeEvent = z.infer<typeof IntakeEventSchema>;

/** 新来件：id、状态、判案结果由收件库填。 */
export type NewIntakeItem = Pick<
  IntakeItem,
  | "channel"
  | "externalKey"
  | "receivedAt"
  | "from"
  | "to"
  | "subject"
  | "text"
  | "thread"
  | "dmarc"
  | "attachments"
  | "source"
>;
