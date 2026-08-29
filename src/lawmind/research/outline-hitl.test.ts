import { describe, expect, it } from "vitest";
import {
  applyOutlineClarificationAnswer,
  outlineAnswerDecision,
  outlineLooksApproved,
  parseOutlineMarkdownSections,
} from "./outline-hitl.js";
import type { ResearchOutline } from "./research-outline.js";

const base: ResearchOutline = {
  title: "测试大纲",
  deliverableType: "report.compliance",
  status: "pending",
  sections: [
    {
      id: "a",
      heading: "问题陈述",
      purpose: "x",
      bullets: ["原要点"],
    },
  ],
  notes: [],
};

describe("outline-hitl", () => {
  it("rejects 不同意 / reject without approving", () => {
    expect(outlineAnswerDecision("不同意大纲")).toBe("rejected");
    expect(outlineAnswerDecision("reject")).toBe("rejected");
    expect(applyOutlineClarificationAnswer(base, "不同意大纲")).toBeNull();
  });

  it("approves explicit confirm and short affirm", () => {
    expect(outlineAnswerDecision("大纲已确认")).toBe("approved");
    expect(outlineAnswerDecision("同意")).toBe("approved");
    const approved = applyOutlineClarificationAnswer(base, "大纲已确认");
    expect(approved?.status).toBe("approved");
    expect(approved?.sections[0]?.heading).toBe("问题陈述");
  });

  it("does not soft-approve 继续 / 可以 / 没问题", () => {
    expect(outlineAnswerDecision("继续")).toBe("unclear");
    expect(outlineAnswerDecision("可以")).toBe("unclear");
    expect(outlineAnswerDecision("没问题")).toBe("unclear");
    expect(outlineLooksApproved("继续")).toBe(false);
    expect(outlineLooksApproved("【补充信息】\n请确认或调整研究大纲\n答：继续")).toBe(false);
  });

  it("parses revise markdown into sections and approves", () => {
    const answer = `大纲已确认\n\n## 新章节甲\n- 要点一\n- 要点二\n\n## 新章节乙\n- 要点三`;
    expect(outlineAnswerDecision(answer)).toBe("revise");
    const sections = parseOutlineMarkdownSections(answer);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.heading).toBe("新章节甲");
    const applied = applyOutlineClarificationAnswer(base, answer);
    expect(applied?.status).toBe("approved");
    expect(applied?.sections.map((s) => s.heading)).toEqual(["新章节甲", "新章节乙"]);
  });

  it("treats free-form prose as unclear", () => {
    expect(outlineAnswerDecision("随便写写看看吧")).toBe("unclear");
    expect(applyOutlineClarificationAnswer(base, "随便写写看看吧")).toBeNull();
  });
});

describe("outlineLooksApproved (structured only)", () => {
  it("ignores bare approve phrases", () => {
    expect(outlineLooksApproved("请按此大纲撰写合规卷宗")).toBe(false);
  });
});
