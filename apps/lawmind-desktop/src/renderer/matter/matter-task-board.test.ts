import { describe, expect, it } from "vitest";
import { mergeTaskBoardRows } from "./matter-task-board.js";

describe("mergeTaskBoardRows", () => {
  it("prioritizes pending approvals and open queue", () => {
    const rows = mergeTaskBoardRows({
      tasks: [
        {
          taskId: "t1",
          kind: "agent.instruction",
          status: "running",
          summary: "任务",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-02",
        } as never,
      ],
      queueItems: [
        {
          queueItemId: "q1",
          matterId: "m1",
          kind: "need_lawyer_review",
          status: "open",
          priority: "high",
          title: "待复核",
          createdAt: "2026-01-03",
          updatedAt: "2026-01-03",
        } as never,
      ],
      approvalRequests: [
        {
          approvalId: "a1",
          matterId: "m1",
          reason: "高风险交付",
          status: "pending",
          requestedAt: "2026-01-04",
          requestedBy: "system",
          riskLevel: "high",
        } as never,
      ],
      drafts: [],
    });
    expect(rows[0]?.kind).toBe("approval");
    expect(rows.some((r) => r.kind === "queue")).toBe(true);
  });

  it("includes running jobs", () => {
    const rows = mergeTaskBoardRows({
      tasks: [],
      queueItems: [],
      approvalRequests: [],
      drafts: [],
      jobs: [
        {
          jobId: "j1",
          workflowId: "contract-review",
          status: "running",
          matterId: "m1",
          createdAt: "2026-01-05",
          workflowName: "合同审查",
        },
      ],
    });
    expect(rows.some((r) => r.kind === "job" && r.statusLabel === "运行中")).toBe(true);
  });
});
