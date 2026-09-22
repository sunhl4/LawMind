import { describe, expect, it } from "vitest";
import {
  buildDeliverablePipelineSystemNote,
  shouldAutoRunDeliverableWorkflow,
} from "./deliverable-pipeline.js";

describe("deliverable-pipeline", () => {
  it("detects EU NEV ESG report as auto-workflow", () => {
    expect(shouldAutoRunDeliverableWorkflow("写一个详细的欧盟新能源汽车相关的 ESG 报告")).toBe(
      true,
    );
  });

  it("does not auto-run model meta questions", () => {
    expect(shouldAutoRunDeliverableWorkflow("你是什么模型")).toBe(false);
    expect(shouldAutoRunDeliverableWorkflow("请测试当前模型 API 连接")).toBe(false);
  });

  it("builds system note for formal deliverables", () => {
    const note = buildDeliverablePipelineSystemNote("撰写 ESG 年度报告");
    expect(note).toContain("execute_workflow");
    expect(note).toContain("审核");
    expect(note).toContain("原则指针");
    expect(note).not.toContain("禁止仅在对话里粘贴");
  });
});
