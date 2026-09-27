import { describe, expect, it } from "vitest";
import {
  attachDraftWorkerJoinIndex,
  buildDraftWorkerJoinIndex,
  draftWorkerSectionErrors,
} from "./draft-worker-batch.js";
import type { AgentMessage } from "./types.js";

describe("draftWorkerSectionErrors", () => {
  it("allows a single worker with an empty section", () => {
    expect(
      draftWorkerSectionErrors([{ id: "a", name: "draft_worker", arguments: { goal: "写违约金" } }])
        .size,
    ).toBe(0);
  });

  it("fails every call that shares a section", () => {
    const errors = draftWorkerSectionErrors([
      { id: "a", name: "draft_worker", arguments: { section: "违约金" } },
      { id: "b", name: "draft_worker", arguments: { section: "管辖" } },
      { id: "c", name: "draft_worker", arguments: { section: "违约金" } },
    ]);
    expect(errors.get("a")).toContain("违约金");
    expect(errors.get("c")).toContain("违约金");
    expect(errors.has("b")).toBe(false);
  });

  it("fails a blank section inside a parallel batch", () => {
    const errors = draftWorkerSectionErrors([
      { id: "a", name: "draft_worker", arguments: { section: "违约金" } },
      { id: "b", name: "draft_worker", arguments: { section: "  " } },
    ]);
    expect(errors.get("b")).toContain("章节名");
    expect(errors.has("a")).toBe(false);
  });
});

describe("buildDraftWorkerJoinIndex", () => {
  it("lists gaps and shared citations", () => {
    const index = buildDraftWorkerJoinIndex([
      { section: "违约金", gaps: ["金额未定"], citations: ["买卖合同.docx"] },
      { section: "管辖", gaps: [], citations: ["买卖合同.docx", "《民事诉讼法》"] },
    ]);
    expect(index).toContain("【并行写稿对照】");
    expect(index).toContain("违约金：缺口 金额未定");
    expect(index).toContain("管辖：缺口 无");
    expect(index).toContain("引用重复：买卖合同.docx（违约金、管辖）");
    expect(index).not.toContain("《民事诉讼法》");
  });
});

describe("attachDraftWorkerJoinIndex", () => {
  it("patches both tool messages", () => {
    const messages: AgentMessage[] = ["违约金", "管辖"].map((section, index) => ({
      role: "tool",
      content: "{}",
      toolCallResponses: [
        {
          toolCallId: `c${index}`,
          name: "draft_worker",
          result: {
            ok: true,
            data: { section, draft: section, citations: ["买卖合同.docx"], gaps: [] },
          },
        },
      ],
      timestamp: "2026-09-27T00:00:00.000Z",
    }));
    attachDraftWorkerJoinIndex([
      {
        toolName: "draft_worker",
        toolArgs: { section: "违约金" },
        toolResponseMsg: messages[0],
      },
      {
        toolName: "draft_worker",
        toolArgs: { section: "管辖" },
        toolResponseMsg: messages[1],
      },
    ]);
    expect(messages[0]?.content).toContain("【并行写稿对照】");
    expect(messages[1]?.content).toContain("引用重复：买卖合同.docx");
  });
});
