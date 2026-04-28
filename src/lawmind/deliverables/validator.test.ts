import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { isDraftReadyForRender, validateDraftAgainstSpec } from "./validator.js";

function makeDraft(partial: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-test-001",
    title: "测试文书",
    output: "docx",
    templateId: "contract-rental-default",
    deliverableType: "contract.rental",
    summary: "测试摘要",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

const FULL_RENTAL_SECTIONS = [
  { heading: "一、合同主体", body: "出租人甲方：…；承租人乙方：…" },
  { heading: "二、房屋信息", body: "房屋坐落于…，面积…，用途…" },
  { heading: "三、租期", body: "租赁期限自…起至…止。" },
  { heading: "四、租金与押金", body: "月租金…元；押金…元；按月支付。" },
  { heading: "五、维修与费用", body: "日常维修由乙方承担；大修由甲方承担。" },
  { heading: "六、违约与解除", body: "任一方违约…解除条件…" },
  { heading: "七、争议解决", body: "适用中华人民共和国法律；管辖法院…" },
  { heading: "八、签署页", body: "甲方签字：…  乙方签字：…  日期：…" },
];

describe("deliverables/validator", () => {
  it("flags missing blocker sections as not ready", () => {
    const draft = makeDraft({
      sections: [{ heading: "一、合同主体", body: "甲方/乙方…" }],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBeGreaterThan(0);
  });

  it("passes a structurally complete rental contract", () => {
    const draft = makeDraft({ sections: FULL_RENTAL_SECTIONS });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(true);
    expect(report.blockerCount).toBe(0);
  });

  it("counts placeholders and exposes samples", () => {
    const draft = makeDraft({
      sections: [
        ...FULL_RENTAL_SECTIONS.slice(0, 7),
        {
          heading: "八、签署页",
          body: "甲方：【待补充：出租人姓名】；乙方：【待补充：承租人姓名】",
        },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.placeholderCount).toBe(2);
    expect(report.placeholderSamples.length).toBe(2);
    expect(report.placeholderSamples[0]).toContain("【待补充");
  });

  it("rental contract stays ready even with placeholders (signed offline)", () => {
    const draft = makeDraft({
      sections: [
        ...FULL_RENTAL_SECTIONS.slice(0, 7),
        { heading: "八、签署页", body: "甲方：【待补充：出租人姓名】" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(true);
    const placeholderCheck = report.checks.find((c) => c.key === "placeholders.resolved");
    expect(placeholderCheck?.severity).toBe("warning");
  });

  it("demand letter blocks render until placeholders resolved", () => {
    const draft = makeDraft({
      deliverableType: "letter.demand",
      templateId: "letter-demand-default",
      sections: [
        { heading: "致：xx 公司", body: "受函人：xx" },
        { heading: "事实背景", body: "依据合同…" },
        { heading: "本所主张", body: "请求贵司在【待补充：履行期限】前履行…" },
        { heading: "履行期限", body: "请于【待补充：日期】前履行" },
        { heading: "落款", body: "xx 律师事务所，xx 律师" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const placeholderCheck = report.checks.find((c) => c.key === "placeholders.resolved");
    expect(placeholderCheck?.severity).toBe("blocker");
    expect(report.ready).toBe(false);
  });

  it("isDraftReadyForRender mirrors report.ready", () => {
    const draft = makeDraft({ sections: FULL_RENTAL_SECTIONS });
    expect(isDraftReadyForRender(draft)).toBe(true);
  });

  it("returns spec.not_found warning when deliverableType missing", () => {
    const draft = makeDraft({ deliverableType: undefined, sections: [] });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(true);
    expect(report.checks[0]?.key).toBe("spec.not_found");
  });

  it("surfaces open clarification questions as a warning check", () => {
    const draft = makeDraft({
      sections: FULL_RENTAL_SECTIONS,
      clarificationQuestions: [{ key: "rent_amount", question: "请补充月租金金额。" }],
    });
    const report = validateDraftAgainstSpec(draft);
    const c = report.checks.find((x) => x.key === "clarifications.closed");
    expect(c).toBeDefined();
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe("warning");
    // warning 不阻断 ready
    expect(report.ready).toBe(true);
  });

  it("adds a warning when body placeholder-density heuristic is high (long draft)", () => {
    const cell = `出租人${"·".repeat(30)} __FILL__ 承租人${"·".repeat(30)} __FILL2__ `;
    const longBody = Array.from({ length: 6 }, () => cell).join("\n\n");
    const draft = makeDraft({
      sections: [
        { heading: "一、合同主体", body: longBody },
        { heading: "二、房屋信息", body: longBody },
        { heading: "三、租期", body: "自… 至 …" },
        { heading: "四、租金与押金", body: "月租…" },
        { heading: "五、维修与费用", body: "…" },
        { heading: "六、违约与解除", body: "…" },
        { heading: "七、争议解决", body: "…" },
        { heading: "八、签署页", body: "…" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const c = report.checks.find((x) => x.key === "draft.body.placeholder_density_heuristic");
    expect(c).toBeDefined();
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe("warning");
  });
});
