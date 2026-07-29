/**
 * Pure sidebar filter helpers from lawmind-app-shell-domains.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import {
  filterHistoryForSidebar,
  filterTasksForSidebar,
  selectStableAssistantId,
} from "./lawmind-app-shell-domains.ts";
import type { HistoryItem, TaskRow } from "./lawmind-app-data";
import type { AssistantRow } from "./lawmind-settings-models";

describe("lawmind-app-shell-domains", () => {
  const now = new Date().toISOString();
  const assistants: AssistantRow[] = [
    {
      assistantId: "asst_a",
      displayName: "A",
      introduction: "",
      presetKey: "p",
      createdAt: now,
      updatedAt: now,
    },
    {
      assistantId: "asst_b",
      displayName: "B",
      introduction: "",
      presetKey: "p",
      createdAt: now,
      updatedAt: now,
    },
  ];

  it("selectStableAssistantId keeps previous when still present", () => {
    expect(selectStableAssistantId(assistants, "asst_b")).toBe("asst_b");
  });

  it("selectStableAssistantId falls back to first or default", () => {
    expect(selectStableAssistantId(assistants, "gone")).toBe("asst_a");
    expect(selectStableAssistantId([], "gone")).toBe(DEFAULT_ASSISTANT_ID);
  });

  it("filterTasksForSidebar respects assistant scope, range, and query", () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const tasks: TaskRow[] = [
      {
        taskId: "t1",
        title: "租赁备忘",
        summary: "memo",
        kind: "draft.word",
        matterId: "m1",
        assistantId: "asst_a",
        updatedAt: now,
        status: "running",
      },
      {
        taskId: "t2",
        title: "other",
        summary: "x",
        kind: "agent.instruction",
        matterId: "m2",
        assistantId: "asst_b",
        updatedAt: now,
        status: "done",
      },
      {
        taskId: "t3",
        title: "old task",
        summary: "y",
        kind: "draft.word",
        matterId: "m1",
        assistantId: "asst_a",
        updatedAt: old,
        status: "done",
      },
    ];
    expect(filterTasksForSidebar(tasks, "", "all", "asst_a")).toHaveLength(2);
    expect(filterTasksForSidebar(tasks, "租赁", "all", "asst_a")).toHaveLength(1);
    expect(filterTasksForSidebar(tasks, "", "30d", "asst_a")).toHaveLength(1);
    expect(filterTasksForSidebar(tasks, "", "all", null)).toHaveLength(3);
  });

  it("filterHistoryForSidebar mirrors task filters", () => {
    const history: HistoryItem[] = [
      {
        id: "h1",
        label: "会话一",
        kind: "task",
        updatedAt: now,
        assistantId: "asst_a",
        matterId: "m1",
      },
      {
        id: "h2",
        label: "会话二",
        kind: "draft",
        updatedAt: now,
        assistantId: "asst_b",
      },
    ];
    expect(filterHistoryForSidebar(history, "会话一", "all", "asst_a")).toHaveLength(1);
    expect(filterHistoryForSidebar(history, "", "all", null)).toHaveLength(2);
  });
});
