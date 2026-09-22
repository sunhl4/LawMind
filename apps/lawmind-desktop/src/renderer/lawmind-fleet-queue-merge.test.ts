import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { mergeFleetQueueRows } from "./lawmind-fleet-queue-merge";

function run(partial: Partial<AgentRunSummary> & { id: string }): AgentRunSummary {
  return {
    kind: "pending_review",
    status: "awaiting_review",
    title: partial.id,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  } as AgentRunSummary;
}

describe("mergeFleetQueueRows", () => {
  it("does not put internal pending-review drafts on 待拍板", () => {
    const rows = mergeFleetQueueRows({
      fleetRuns: [run({ id: "review:t1", taskId: "t1" })],
      pendingReviewDrafts: [
        { taskId: "t1", title: "重复文书", createdAt: "2026-08-01T00:00:00.000Z" },
        { taskId: "t2", title: "新待审文书", createdAt: "2026-08-01T01:00:00.000Z" },
      ] as never,
      automationInbox: [],
      snoozed: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it("maps automation pendingSend to 交办待发信 and ignores internal inbox results", () => {
    const rows = mergeFleetQueueRows({
      fleetRuns: [],
      pendingReviewDrafts: [
        { taskId: "t9", title: "待审文书", createdAt: "2026-08-01T00:00:00.000Z" },
      ] as never,
      automationInbox: [
        {
          id: "inb-1",
          status: "open",
          title: "邮件合同审阅",
          summary: "已完成",
          createdAt: "2026-08-01T02:00:00.000Z",
          matterId: "m1",
          draftTaskId: "t9",
          pendingSend: {
            to: "client@x.com",
            subject: "审阅稿",
            body: "请查收",
            attachmentRelativePaths: ["mail/attachments/a/审阅稿.docx"],
          },
        },
        {
          id: "inb-2",
          status: "open",
          title: "运行结果",
          summary: "与待审文书同任务的交办结果",
          createdAt: "2026-08-01T03:00:00.000Z",
          matterId: "m1",
          draftTaskId: "t9",
        },
        {
          id: "inb-3",
          status: "open",
          title: "独立交办结果",
          summary: "需要知悉",
          createdAt: "2026-08-01T04:00:00.000Z",
          matterId: "m2",
          jobId: "job-1234567890",
        },
      ] as never,
      snoozed: new Set(),
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["automation-send:inb-1"]);
    expect(ids).not.toContain("review:t9");
    expect(ids).not.toContain("automation-inbox:inb-2");
    expect(ids).not.toContain("automation-inbox:inb-3");
    const send = rows.find((r) => r.id === "automation-send:inb-1");
    expect(send?.subtitle).toContain("client@x.com");
    expect(send?.subtitle).toContain("审阅稿.docx");
  });

  it("puts pending-review drafts on 待拍板 when includePendingReview", () => {
    const rows = mergeFleetQueueRows({
      fleetRuns: [run({ id: "review:t1", taskId: "t1" })],
      pendingReviewDrafts: [
        { taskId: "t1", title: "重复文书", createdAt: "2026-08-01T00:00:00.000Z", reviewStatus: "pending" },
        { taskId: "t2", title: "新待审文书", createdAt: "2026-08-01T01:00:00.000Z", reviewStatus: "pending" },
      ],
      automationInbox: [],
      snoozed: new Set(),
      includePendingReview: true,
    });
    expect(rows.map((r) => r.id)).toEqual(["review:t1", "review:t2"]);
    expect(rows.find((r) => r.id === "review:t2")?.title).toBe("新待审文书");
  });

  it("keeps 签批稿 and 待发信 as separate tickets when includePendingReview", () => {
    const rows = mergeFleetQueueRows({
      fleetRuns: [],
      pendingReviewDrafts: [
        { taskId: "t9", title: "待审文书", createdAt: "2026-08-01T00:00:00.000Z", reviewStatus: "pending" },
      ],
      automationInbox: [
        {
          id: "inb-1",
          status: "open",
          title: "邮件合同审阅",
          summary: "已完成",
          createdAt: "2026-08-01T02:00:00.000Z",
          matterId: "m1",
          draftTaskId: "t9",
          pendingSend: {
            to: "client@x.com",
            subject: "审阅稿",
            body: "请查收",
          },
        },
      ] as never,
      snoozed: new Set(),
      includePendingReview: true,
    });
    expect(rows.map((r) => r.id)).toEqual(["review:t9", "automation-send:inb-1"]);
  });

  it("filters snoozed outbound rows", () => {
    const rows = mergeFleetQueueRows({
      fleetRuns: [
        run({ id: "automation-send:a", kind: "automation_send", status: "awaiting_approval" }),
        run({ id: "automation-send:b", kind: "automation_send", status: "awaiting_approval" }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(["automation-send:a"]),
    });
    expect(rows.map((r) => r.id)).toEqual(["automation-send:b"]);
  });
});
