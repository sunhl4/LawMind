import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../types.js";
import { taskIntentFromRecordOnly } from "./task-intent.js";

describe("taskIntentFromRecordOnly", () => {
  it("builds intent from record without draft", () => {
    const record: TaskRecord = {
      taskId: "task-abc",
      kind: "draft.word",
      instruction: "起草租赁合同",
      summary: "租赁合同起草",
      output: "docx",
      riskLevel: "medium",
      requiresConfirmation: false,
      matterId: "m1",
      templateId: "word/legal-memo-default",
      deliverableType: "contract.rental",
      status: "researched",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T01:00:00.000Z",
    };
    const intent = taskIntentFromRecordOnly(record);
    expect(intent.taskId).toBe("task-abc");
    expect(intent.kind).toBe("draft.word");
    expect(intent.instruction).toBe("起草租赁合同");
    expect(intent.templateId).toBe("word/legal-memo-default");
    expect(intent.matterId).toBe("m1");
  });

  it("uses default template when record has none", () => {
    const record: TaskRecord = {
      taskId: "t2",
      kind: "draft.word",
      summary: "s",
      output: "docx",
      riskLevel: "low",
      requiresConfirmation: false,
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const intent = taskIntentFromRecordOnly(record);
    expect(intent.templateId).toBe("word/legal-memo-default");
  });
});
