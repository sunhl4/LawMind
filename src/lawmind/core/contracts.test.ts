import { describe, expect, it } from "vitest";
import type { ArtifactDraft, MatterIndex, TaskRecord } from "../types.js";
import {
  buildApprovalRequestsFromMatterIndex,
  buildDeliverableFromDraft,
  buildMatterFromIndex,
  buildMatterReadModelFromIndex,
  buildQueueItemsFromMatterIndex,
} from "./contracts.js";

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "task-1",
    kind: "draft.word",
    summary: "起草律师意见",
    output: "docx",
    riskLevel: "medium",
    requiresConfirmation: false,
    matterId: "matter-1",
    templateId: "word/legal-memo-default",
    status: "drafted",
    createdAt: "2026-04-01T09:00:00.000Z",
    updatedAt: "2026-04-01T09:10:00.000Z",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-1",
    matterId: "matter-1",
    title: "案件法律意见",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "关于违约责任的初步法律意见",
    sections: [{ heading: "一、结论", body: "违约责任初步成立。", citations: ["src-1"] }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-04-01T09:00:00.000Z",
    ...overrides,
  };
}

function makeIndex(overrides: Partial<MatterIndex> = {}): MatterIndex {
  const task = makeTask();
  const draft = makeDraft();
  return {
    matterId: "matter-1",
    caseFilePath: "/tmp/CASE.md",
    caseMemory:
      "# 案件档案\n\n## 4. 核心争点\n\n- 违约责任是否成立\n\n## 6. 当前任务目标\n\n- 形成可审阅意见\n\n## 7. 风险与待确认事项\n\n- 送达证据仍待补充\n",
    coreIssues: ["违约责任是否成立"],
    taskGoals: ["形成可审阅意见"],
    riskNotes: ["送达证据仍待补充"],
    progressEntries: ["已完成初步检索"],
    artifacts: [],
    tasks: [task],
    drafts: [draft],
    auditEvents: [
      {
        eventId: "evt-1",
        taskId: "task-1",
        kind: "draft.created",
        actor: "system",
        timestamp: "2026-04-01T09:05:00.000Z",
      },
    ],
    openTasks: [task],
    renderedTasks: [],
    latestUpdatedAt: "2026-04-01T09:10:00.000Z",
    ...overrides,
  };
}

describe("LawMind core contracts adapters", () => {
  it("maps a pending draft into a deliverable", () => {
    const deliverable = buildDeliverableFromDraft(makeDraft(), makeTask());
    expect(deliverable).toBeTruthy();
    expect(deliverable?.matterId).toBe("matter-1");
    expect(deliverable?.kind).toBe("legal-memo");
    expect(deliverable?.status).toBe("pending_review");
    expect(deliverable?.blockingReasons).toContain("awaiting_review");
  });

  it("derives matter status from a review-pending index", () => {
    const matter = buildMatterFromIndex(makeIndex());
    expect(matter.status).toBe("under_review");
    expect(matter.title).toContain("违约责任");
    expect(matter.nextActions[0]).toContain("drafted");
  });

  it("builds a matter read model with deliverables and activity", () => {
    const model = buildMatterReadModelFromIndex(makeIndex());
    expect(model.matter.matterId).toBe("matter-1");
    expect(model.deliverables).toHaveLength(1);
    expect(model.latestActivity.some((item) => item.label.includes("draft.created"))).toBe(true);
  });

  it("marks a matter delivered when all work is rendered", () => {
    const renderedTask = makeTask({ status: "rendered", updatedAt: "2026-04-01T09:20:00.000Z" });
    const renderedDraft = makeDraft({
      reviewStatus: "approved",
      outputPath: "/tmp/out.docx",
      reviewedAt: "2026-04-01T09:15:00.000Z",
    });
    const matter = buildMatterFromIndex(
      makeIndex({
        tasks: [renderedTask],
        openTasks: [],
        renderedTasks: [renderedTask],
        drafts: [renderedDraft],
      }),
    );
    expect(matter.status).toBe("delivered");
  });

  it("derives approval requests from task confirmation and draft review state", () => {
    const approvals = buildApprovalRequestsFromMatterIndex(
      makeIndex({
        tasks: [makeTask({ requiresConfirmation: true, status: "created", riskLevel: "high" })],
      }),
    );
    expect(approvals.some((item) => item.approvalId.endsWith(":task-confirmation"))).toBe(true);
    expect(approvals.some((item) => item.approvalId.endsWith(":draft-review"))).toBe(true);
    expect(approvals.find((item) => item.approvalId.endsWith(":task-confirmation"))?.status).toBe(
      "pending",
    );
  });

  it("derives queue items for review, evidence, and renderable drafts", () => {
    const items = buildQueueItemsFromMatterIndex(
      makeIndex({
        drafts: [
          makeDraft({
            reviewStatus: "approved",
            reviewedAt: "2026-04-01T09:15:00.000Z",
          }),
        ],
      }),
    );
    expect(items.some((item) => item.kind === "ready_to_render")).toBe(true);
    expect(items.some((item) => item.kind === "need_evidence")).toBe(true);
  });
});
