import { describe, expect, it } from "vitest";
import { partitionActivityForThoughtView } from "./lawmind-chat-thought-view.js";

describe("partitionActivityForThoughtView", () => {
  it("keeps streaming text in reasoning, not answer", () => {
    const blocks = [
      { id: "t1", kind: "text" as const, content: "我先分析案情。" },
      {
        id: "tc1",
        kind: "tool" as const,
        toolCallId: "tc1",
        toolName: "research_task",
        label: "法规检索",
        status: "running" as const,
        progress: ["检索法规库"],
      },
    ];
    const out = partitionActivityForThoughtView(blocks, { streaming: true });
    expect(out.reasoningMarkdown).toContain("分析案情");
    expect(out.answerText).toBe("");
    expect(out.tools).toHaveLength(1);
  });

  it("splits multi-text into reasoning and answer when done", () => {
    const blocks = [
      { id: "t1", kind: "text" as const, content: "计划阶段。" },
      { id: "t2", kind: "text" as const, content: "最终答复。" },
    ];
    const out = partitionActivityForThoughtView(blocks, { streaming: false });
    expect(out.reasoningMarkdown).toBe("计划阶段。");
    expect(out.answerText).toBe("最终答复。");
  });

  it("puts single text after tools into answer when complete", () => {
    const blocks = [
      {
        id: "tc1",
        kind: "tool" as const,
        toolCallId: "tc1",
        toolName: "analyze_document",
        label: "阅读文档",
        status: "done" as const,
        progress: [],
      },
      { id: "t1", kind: "text" as const, content: "结论如下。" },
    ];
    const out = partitionActivityForThoughtView(blocks, { streaming: false, finalText: "结论如下。" });
    expect(out.tools).toHaveLength(1);
    expect(out.reasoningMarkdown).toBe("");
    expect(out.answerText).toBe("结论如下。");
  });
});
