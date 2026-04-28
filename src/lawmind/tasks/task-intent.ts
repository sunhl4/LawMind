import type { ArtifactDraft, TaskIntent, TaskRecord } from "../types.js";

const DEFAULT_DRAFT_TEMPLATE_ID = "word/legal-memo-default";

/** 仅从任务记录还原 TaskIntent（无草稿时用于工作流续跑，如跳过 plan 后重试检索）。 */
export function taskIntentFromRecordOnly(record: TaskRecord): TaskIntent {
  return {
    taskId: record.taskId,
    kind: record.kind,
    output: record.output,
    instruction: record.instruction ?? record.summary,
    summary: record.summary,
    riskLevel: record.riskLevel,
    models: ["legal"],
    requiresConfirmation: record.requiresConfirmation,
    createdAt: record.createdAt,
    matterId: record.matterId,
    templateId: record.templateId ?? DEFAULT_DRAFT_TEMPLATE_ID,
    deliverableType: record.deliverableType,
    acceptanceCriteria: record.acceptanceCriteria,
    clarificationQuestions: record.clarificationQuestions,
    audience: record.audience,
  };
}

/** 从持久化任务记录 + 草稿还原 TaskIntent（供推理图谱等模块使用）。 */
export function taskIntentFromRecord(record: TaskRecord, draft: ArtifactDraft): TaskIntent {
  return {
    taskId: record.taskId,
    kind: record.kind,
    output: record.output,
    instruction: record.instruction ?? record.summary,
    summary: record.summary,
    riskLevel: record.riskLevel,
    models: ["legal"],
    requiresConfirmation: record.requiresConfirmation,
    createdAt: record.createdAt,
    matterId: record.matterId,
    templateId: record.templateId ?? draft.templateId,
    deliverableType: record.deliverableType ?? draft.deliverableType,
    acceptanceCriteria: record.acceptanceCriteria ?? draft.acceptanceCriteria,
    clarificationQuestions: record.clarificationQuestions ?? draft.clarificationQuestions,
    audience: record.audience,
  };
}
