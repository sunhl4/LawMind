/**
 * Unit tests for Instruction Router.
 */

import { describe, it, expect } from "vitest";
import { route } from "./index.js";

describe("LawMind Router", () => {
  it("maps 合同审查 to analyze.contract, medium risk, docx", () => {
    const intent = route({ instruction: "请审查这份合同条款" });
    expect(intent.kind).toBe("analyze.contract");
    expect(intent.riskLevel).toBe("medium");
    expect(intent.output).toBe("docx");
    expect(intent.models).toEqual(["general", "legal"]);
    expect(intent.requiresConfirmation).toBe(false);
    expect(intent.taskId).toBeDefined();
    expect(intent.summary).toContain("合同审查");
  });

  it("maps 律师函 to draft.word, high risk", () => {
    const intent = route({ instruction: "写一封催款律师函" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.riskLevel).toBe("high");
    expect(intent.output).toBe("docx");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("maps 起草合同 to draft.word instead of contract review", () => {
    const intent = route({ instruction: "请起草一份租赁合同" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("contract.rental");
    expect(intent.output).toBe("docx");
    expect(intent.riskLevel).toBe("high");
    expect(intent.clarificationQuestions?.length).toBeGreaterThan(0);
  });

  it("maps 法律意见/法条 to research.legal, legal model only", () => {
    const intent = route({ instruction: "查一下民法典相关法条和司法解释" });
    expect(intent.kind).toBe("research.legal");
    expect(intent.models).toEqual(["legal"]);
    expect(intent.riskLevel).toBe("medium");
  });

  it("maps PPT/汇报 to draft.ppt, pptx, general only", () => {
    const intent = route({ instruction: "做一份客户汇报的PPT" });
    expect(intent.kind).toBe("draft.ppt");
    expect(intent.output).toBe("pptx");
    expect(intent.models).toEqual(["general"]);
    expect(intent.riskLevel).toBe("high");
  });

  it("maps 检索/调研 to research.hybrid", () => {
    const intent = route({ instruction: "检索一下竞品合规背景" });
    expect(intent.kind).toBe("research.hybrid");
    expect(intent.models).toEqual(["general", "legal"]);
  });

  it("passes through audience and templateId", () => {
    const intent = route({
      instruction: "生成律师函",
      audience: "客户",
      templateId: "word/demand-letter-default",
    });
    expect(intent.audience).toBe("客户");
    expect(intent.templateId).toBe("word/demand-letter-default");
  });

  it("returns unknown for unrecognized instruction, requires confirmation", () => {
    const intent = route({ instruction: "随便做点什么奇怪的事" });
    expect(intent.kind).toBe("unknown");
    expect(intent.requiresConfirmation).toBe(true);
    expect(intent.summary).toContain("未识别");
  });
});
