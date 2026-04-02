import type { ArtifactDraft, TaskIntent, TaskRecord } from "../types.js";

/** 从持久化任务记录 + 草稿还原 TaskIntent（供推理图谱等模块使用）。 */
export function taskIntentFromRecord(record: TaskRecord, draft: ArtifactDraft): TaskIntent {
  return {
    taskId: record.taskId,
    kind: record.kind,
    output: record.output,
    summary: record.summary,
    riskLevel: record.riskLevel,
    models: ["legal"],
    requiresConfirmation: record.requiresConfirmation,
    createdAt: record.createdAt,
    matterId: record.matterId,
    templateId: record.templateId ?? draft.templateId,
    audience: record.audience,
  };
}
