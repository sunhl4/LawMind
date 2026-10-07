import { describe, expect, it } from "vitest";
import {
  attachDraftWorkerJoinIndex,
  buildDraftWorkerJoinIndex,
  draftWorkerDispatchErrors,
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

describe("draftWorkerDispatchErrors", () => {
  it("does not keyword-reject a short brief, and still flags a duplicate section", () => {
    const errors = draftWorkerDispatchErrors([
      { id: "short", name: "draft_worker", arguments: { goal: "写一句", section: "付款" } },
      {
        id: "a",
        name: "draft_worker",
        arguments: { goal: "对照合同", materials: "采购合同.docx", section: "解除" },
      },
      {
        id: "b",
        name: "draft_worker",
        arguments: { goal: "对照合同", materials: "采购合同.docx", section: "解除" },
      },
    ]);
    expect(errors.has("short")).toBe(false);
    expect(errors.get("a")).toContain("解除");
    expect(errors.get("b")).toContain("解除");
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

  it("lists each conclusion and does not label a conflict", () => {
    const index = buildDraftWorkerJoinIndex([
      { section: "解除", gaps: [], citations: ["合同第15条"], conclusion: "乙方有权解除" },
      { section: "管辖", gaps: [], citations: ["合同第20条"], conclusion: "乙方无权解除" },
    ]);
    expect(index).toContain("结论 乙方有权解除");
    expect(index).toContain("结论 乙方无权解除");
    expect(index).toContain("共享锚已由引擎融合");
    expect(index).not.toContain("是否互相矛盾由你判断");
    expect(index).not.toContain("结论冲突");
    expect(index).not.toContain("【待核实】");
  });

  it("keeps conclusions that a word list would have called opposite", () => {
    const index = buildDraftWorkerJoinIndex([
      { section: "付款", gaps: [], citations: [], conclusion: "应当支付违约金" },
      { section: "担保", gaps: [], citations: [], conclusion: "不应当支付违约金" },
      { section: "效力甲", gaps: [], citations: [], conclusion: "该约定有效" },
      { section: "效力乙", gaps: [], citations: [], conclusion: "该约定无效" },
    ]);
    expect(index).toContain("结论 应当支付违约金");
    expect(index).toContain("结论 该约定无效");
    expect(index).not.toContain("结论冲突");
    expect(index).not.toContain("【待核实】");
  });

  it("fuses opposite conclusions that share an anchor", () => {
    const index = buildDraftWorkerJoinIndex([
      {
        section: "解除甲",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        conclusion: "乙方有权解除",
      },
      {
        section: "解除乙",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        conclusion: "乙方无权解除",
      },
    ]);
    expect(index).toContain("【待核实】clause:解除：乙方有权解除；乙方无权解除");
    expect(index).not.toContain("是否互相矛盾由你判断");
  });

  it("keeps one outcome id when the two wordings differ", () => {
    const index = buildDraftWorkerJoinIndex([
      {
        section: "解除甲",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        outcomeId: "may_terminate",
        conclusion: "乙方有权解除",
        span: "第十五条",
      },
      {
        section: "解除乙",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        outcomeId: "may_terminate",
        conclusion: "乙方可以解除本合同",
        span: "第十五条",
      },
    ]);
    expect(index).toContain("共享锚 clause:解除：may_terminate");
    expect(index).not.toContain("【待核实】clause:解除");
  });

  it("writes 【待核实】 when the same outcome id has contradictory spans", () => {
    const index = buildDraftWorkerJoinIndex([
      {
        section: "解除甲",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        outcomeId: "may_terminate",
        conclusion: "乙方有权解除",
        span: "乙方有权解除",
      },
      {
        section: "解除乙",
        gaps: [],
        citations: [],
        anchor: "clause:解除",
        outcomeId: "may_terminate",
        conclusion: "乙方有权解除",
        span: "乙方无权解除",
      },
    ]);
    expect(index).toContain("【待核实】clause:解除");
    expect(index).not.toContain("共享锚 clause:解除：may_terminate");
  });

  it("does not invent a conflict from a hedged conclusion", () => {
    const index = buildDraftWorkerJoinIndex([
      { section: "解除", gaps: [], citations: [], conclusion: "有权解除，但不能解除" },
      { section: "管辖", gaps: [], citations: [], conclusion: "约定了仲裁" },
    ]);
    expect(index).toContain("结论 有权解除，但不能解除");
    expect(index).not.toContain("结论冲突");
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
