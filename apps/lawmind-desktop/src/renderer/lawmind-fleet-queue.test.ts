import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import {
  defaultExpandedFleetGroups,
  fleetApprovalDockLabels,
  fleetRunNeedsLawyer,
  fleetStatusKind,
  fleetStatusLabel,
  groupFleetQueue,
  resolveFleetSelectedId,
} from "./lawmind-fleet-queue";

function run(partial: Partial<AgentRunSummary> & Pick<AgentRunSummary, "id" | "status">): AgentRunSummary {
  return {
    kind: "pending_review",
    title: "t",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...partial,
  } as AgentRunSummary;
}

describe("lawmind-fleet-queue", () => {
  it("classifies statuses for lawyer queue", () => {
    expect(fleetStatusKind("awaiting_clarification")).toBe("clarify");
    expect(fleetStatusKind("awaiting_approval")).toBe("approve");
    expect(fleetStatusKind("awaiting_review")).toBe("review");
    expect(fleetStatusLabel("awaiting_review")).toBe("待签批");
    expect(fleetRunNeedsLawyer(run({ id: "1", status: "awaiting_review" }))).toBe(false);
    expect(
      fleetRunNeedsLawyer(
        run({ id: "s", kind: "automation_send", status: "awaiting_approval" }),
      ),
    ).toBe(true);
    expect(fleetApprovalDockLabels("continue_tools")).toEqual({
      primary: "继续",
      secondary: "先停在这里",
    });
    expect(fleetApprovalDockLabels("tool_approval")).toEqual({
      primary: "批准",
      secondary: "驳回",
    });
  });

  it("resolveFleetSelectedId keeps a valid pick and otherwise opens the first ticket", () => {
    const rows = [
      run({ id: "a", status: "awaiting_review" }),
      run({ id: "b", status: "awaiting_approval" }),
    ];
    expect(resolveFleetSelectedId([], "a")).toBeNull();
    expect(resolveFleetSelectedId(rows, "b")).toBe("b");
    expect(resolveFleetSelectedId(rows, "gone")).toBe("a");
    expect(resolveFleetSelectedId(rows, null)).toBe("a");
  });

  it("groups runs and omits empty buckets", () => {
    const groups = groupFleetQueue([
      run({ id: "a", status: "awaiting_review" }),
      run({ id: "b", status: "awaiting_approval" }),
      run({ id: "c", status: "awaiting_review" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["review", "approve"]);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]?.items).toHaveLength(1);
    expect([...defaultExpandedFleetGroups(groups)].toSorted()).toEqual(["approve", "review"]);
    expect(defaultExpandedFleetGroups([])).toEqual(new Set());
  });

  it("collapses the same LawyerWork into one queue row", () => {
    const groups = groupFleetQueue([
      run({
        id: "chat:s1",
        status: "awaiting_clarification",
        workId: "w_1",
        sessionId: "s1",
      }),
      run({
        id: "review:t1",
        status: "awaiting_review",
        workId: "w_1",
        taskId: "t1",
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.status).toBe("awaiting_review");
    expect(groups[0]?.items[0]?.sessionId).toBe("s1");
    expect(groups[0]?.items[0]?.taskId).toBe("t1");
  });
});
