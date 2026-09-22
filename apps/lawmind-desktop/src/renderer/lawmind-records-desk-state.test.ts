import { describe, expect, it } from "vitest";
import type { HistoryItem, TaskRow } from "./lawmind-app-data";
import type { MatterOverview } from "../../../../src/lawmind/types.ts";
import {
  RECORDS_DESK_UNLINKED,
  buildMatterSidebarRows,
  rangeStartMs,
} from "./lawmind-records-desk-state.ts";

describe("lawmind-records-desk-state", () => {
  it("rangeStartMs returns null for all", () => {
    expect(rangeStartMs("all")).toBeNull();
    expect(rangeStartMs("7d")).toBeLessThan(Date.now());
    expect(rangeStartMs("30d")).toBeLessThan(Date.now());
    expect(rangeStartMs("today")).toBeLessThanOrEqual(Date.now());
  });

  it("buildMatterSidebarRows merges overviews tasks and unlinked", () => {
    const now = new Date().toISOString();
    const overviews: MatterOverview[] = [
      {
        matterId: "m1",
        displayName: "张三租赁案",
        latestUpdatedAt: now,
        openTaskCount: 1,
        renderedTaskCount: 0,
        riskCount: 0,
        artifactCount: 1,
        topIssue: "押金",
      },
    ];
    const tasks: TaskRow[] = [
      {
        taskId: "t1",
        title: "备忘",
        summary: "s",
        kind: "draft.word",
        matterId: "m2",
        updatedAt: now,
        status: "running",
      },
      {
        taskId: "t2",
        title: "orphan",
        summary: "s",
        kind: "agent.instruction",
        updatedAt: now,
        status: "done",
      },
    ];
    const history: HistoryItem[] = [
      {
        id: "h1",
        label: "会话",
        kind: "task",
        matterId: "m1",
        updatedAt: now,
      },
    ];
    const rows = buildMatterSidebarRows(overviews, tasks, history);
    expect(rows.some((r) => r.matterId === "m1")).toBe(true);
    expect(rows.some((r) => r.matterId === "m2")).toBe(true);
    expect(rows.some((r) => r.key === RECORDS_DESK_UNLINKED)).toBe(true);
    expect(rows[0]?.key).not.toBe(RECORDS_DESK_UNLINKED);
  });
});
