import { describe, expect, it } from "vitest";
import {
  filterHistoryForSidebar,
  filterTasksForSidebar,
  selectStableAssistantId,
} from "./lawmind-app-shell-domains.js";
import {
  mapHealthState,
} from "./lawmind-app-shell.js";

describe("lawmind-app-shell", () => {
  it("maps health payload into UI state", () => {
    expect(
      mapHealthState({
        modelConfigured: true,
        retrievalMode: "dual",
        dualLegalConfigured: true,
        webSearchApiKeyConfigured: false,
      }),
    ).toEqual({
      modelConfigured: true,
      retrievalMode: "dual",
      dualLegalConfigured: true,
      webSearchApiKeyConfigured: false,
    });
  });

  it("filters task records by assistant and query", () => {
    expect(
      filterTasksForSidebar(
        [
          {
            taskId: "task-1",
            title: "合同审查",
            summary: "审查采购合同",
            status: "done",
            updatedAt: "2026-01-02T00:00:00.000Z",
            assistantId: "assistant-a",
          },
          {
            taskId: "task-2",
            title: "诉讼分析",
            summary: "分析争议焦点",
            status: "running",
            updatedAt: "2026-01-02T00:00:00.000Z",
            assistantId: "assistant-b",
          },
        ],
        "合同",
        "all",
        "assistant-a",
      ),
    ).toEqual([
      {
        taskId: "task-1",
        title: "合同审查",
        summary: "审查采购合同",
        status: "done",
        updatedAt: "2026-01-02T00:00:00.000Z",
        assistantId: "assistant-a",
      },
    ]);
  });

  it("filters history records by assistant and query", () => {
    expect(
      filterHistoryForSidebar(
        [
          {
            kind: "draft",
            id: "draft-1",
            label: "律师函草稿",
            updatedAt: "2026-01-02T00:00:00.000Z",
            assistantId: "assistant-a",
          },
          {
            kind: "task",
            id: "task-2",
            label: "案件研判",
            updatedAt: "2026-01-02T00:00:00.000Z",
            assistantId: "assistant-b",
          },
        ],
        "律师函",
        "all",
        "assistant-a",
      ),
    ).toEqual([
      {
        kind: "draft",
        id: "draft-1",
        label: "律师函草稿",
        updatedAt: "2026-01-02T00:00:00.000Z",
        assistantId: "assistant-a",
      },
    ]);
  });

  it("keeps the previous assistant when still available", () => {
    expect(
      selectStableAssistantId(
        [
          {
            assistantId: "assistant-a",
            displayName: "A",
            introduction: "",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
          {
            assistantId: "assistant-b",
            displayName: "B",
            introduction: "",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
        "assistant-b",
      ),
    ).toBe("assistant-b");
  });
});
