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
  it("missing keyword sections warn and stay export-ready", () => {
    const draft = makeDraft({
      sections: [{ heading: "一、合同主体", body: "甲方/乙方…" }],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(true);
    expect(report.blockerCount).toBe(0);
    expect(report.warningCount).toBeGreaterThan(0);
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

  it("rental contract blocks export while field placeholders remain", () => {
    const draft = makeDraft({
      sections: [
        ...FULL_RENTAL_SECTIONS.slice(0, 7),
        { heading: "八、签署页", body: "甲方：【待补充：出租人姓名】" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(false);
    const placeholderCheck = report.checks.find((c) => c.key === "placeholders.resolved");
    expect(placeholderCheck?.severity).toBe("blocker");
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

  it("returns spec.not_found blocker when deliverableType missing", () => {
    const draft = makeDraft({ deliverableType: undefined, sections: [] });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(false);
    expect(report.checks[0]?.key).toBe("spec.not_found");
    expect(report.checks[0]?.severity).toBe("blocker");
    expect(report.blockerCount).toBe(1);
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

  it("explicit on-draft type wins over title heuristics (mis-tagged rental stays rental)", () => {
    // 新口径（draft-deliverable-infer.ts）：稿上已写的具体类型优先，
    // 标题启发式只对未定型 / document.general 的稿生效。
    const draft = makeDraft({
      deliverableType: "contract.rental",
      title: "2025 ESG 可持续发展报告",
      sections: [
        { heading: "执行摘要", body: "本年度 ESG 工作概述…" },
        { heading: "环境维度", body: "碳排放与能源…" },
        { heading: "社会维度", body: "员工与社区…" },
        { heading: "治理维度", body: "董事会与合规…" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.deliverableType).toBe("contract.rental");
    // 缺章节只是警告，不挡导出。
    expect(report.ready).toBe(true);
    expect(report.blockerCount).toBe(0);
    expect(report.warningCount).toBeGreaterThan(0);
  });

  it("title heuristics still infer report.esg for an untyped draft", () => {
    const draft = makeDraft({
      deliverableType: undefined,
      title: "2025 ESG 可持续发展报告",
      sections: [
        { heading: "执行摘要", body: "本年度 ESG 工作概述…" },
        { heading: "环境维度", body: "碳排放与能源…" },
        { heading: "社会维度", body: "员工与社区…" },
        { heading: "治理维度", body: "董事会与合规…" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.deliverableType).toBe("report.esg");
    expect(report.ready).toBe(true);
    expect(report.blockerCount).toBe(0);
  });

  it("document.general with only overview does not block export", () => {
    const draft = makeDraft({
      deliverableType: "document.general",
      sections: [{ heading: "事项概述", body: "背景说明…" }],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(true);
    expect(report.blockerCount).toBe(0);
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

  it("warns on contract.review risk chapters without a clause anchor but still exports", () => {
    const draft = makeDraft({
      deliverableType: "contract.review",
      templateId: "review-contract-default",
      sections: [
        { heading: "审查结论", body: "整体可签，但需改违约条款。" },
        { heading: "主要风险", body: "违约金约定偏轻，解除条件不清。" },
        { heading: "修改建议", body: "提高违约金并明确解除触发条件。" },
        { heading: "待确认事项", body: "管辖法院是否可改为上海。" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const clause = report.checks.find((c) => c.key === "contract.review.clause_anchor");
    expect(clause?.passed).toBe(false);
    expect(clause?.severity).toBe("warning");
    expect(report.ready).toBe(true);
  });

  it("accepts contract.review risk anchors via 第×条 or 〔待核实〕", () => {
    const withArticle = makeDraft({
      deliverableType: "contract.review",
      templateId: "review-contract-default",
      sections: [
        { heading: "审查结论", body: "整体可签。" },
        { heading: "主要风险", body: "第 8 条违约金过低。" },
        { heading: "修改建议", body: "建议提高违约金。" },
        { heading: "待确认事项", body: "管辖法院。" },
      ],
    });
    expect(
      validateDraftAgainstSpec(withArticle).checks.find(
        (c) => c.key === "contract.review.clause_anchor",
      )?.passed,
    ).toBe(true);

    const unverified = makeDraft({
      deliverableType: "contract.review",
      templateId: "review-contract-default",
      sections: [
        { heading: "审查结论", body: "整体可签。" },
        { heading: "主要风险", body: "〔待核实〕责任上限是否覆盖间接损失。" },
        { heading: "修改建议", body: "建议补充间接损失排除。" },
        { heading: "待确认事项", body: "管辖法院。" },
      ],
    });
    expect(
      validateDraftAgainstSpec(unverified).checks.find(
        (c) => c.key === "contract.review.clause_anchor",
      )?.passed,
    ).toBe(true);
  });

  it("blocks dense keyword scaffolds from ready/export", () => {
    const draft = makeDraft({
      sections: [
        { heading: "一、合同主体", body: "【出租人】与【承租人】订立本合同。" },
        { heading: "二、房屋信息", body: "房屋坐落于【房屋地址】。" },
        { heading: "三、租期", body: "自… 至 …" },
        { heading: "四、租金与押金", body: "月租…" },
        { heading: "五、维修与费用", body: "…" },
        { heading: "六、违约与解除", body: "…" },
        { heading: "七、争议解决", body: "…" },
        { heading: "八、签署页", body: "…" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const scaffold = report.checks.find((c) => c.key === "draft.scaffold_density");
    expect(scaffold?.passed).toBe(false);
    expect(scaffold?.severity).toBe("blocker");
    expect(report.ready).toBe(false);
  });

  it("does not treat a legal-citation bracket as a dense scaffold", () => {
    const draft = makeDraft({
      deliverableType: "document.general",
      sections: [{ heading: "事项概述", body: "依据【法释〔2023〕1号】解释租赁条款。" }],
    });
    const report = validateDraftAgainstSpec(draft);
    expect(report.checks.find((c) => c.key === "draft.scaffold_density")).toBeUndefined();
    expect(report.ready).toBe(true);
  });

  it("does not let one section's opening satisfy a different required heading", () => {
    const draft = makeDraft({
      sections: [
        {
          heading: "四、租金与押金",
          body: "房屋坐落于上海市某路。月租金1元，按月支付。租期自2026年起。",
        },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const coverage = report.checks.find((c) => c.key === "criteria.coverage");
    expect(coverage?.passed).toBe(false);
    expect(coverage?.severity).toBe("warning");
    expect(coverage?.hint).toContain("租赁标的描述");
    expect(report.ready).toBe(true);
  });

  it("matches a numbered heading from the first 80 characters of the body", () => {
    const draft = makeDraft({
      sections: [{ heading: "一、", body: "合同主体：出租人甲方与承租人乙方。" }],
    });
    const report = validateDraftAgainstSpec(draft);
    const party = report.checks.find((c) => c.label.startsWith("合同双方信息"));
    expect(party?.passed).toBe(true);
  });

  it("reads the parties section when the heading says 当事人 and the names are in the opening", () => {
    const draft = makeDraft({
      sections: [{ heading: "合同当事人", body: "出租人（甲方）：张三。承租人（乙方）：李四。" }],
    });
    const party = validateDraftAgainstSpec(draft).checks.find((c) =>
      c.label.startsWith("合同双方信息"),
    );
    expect(party?.passed).toBe(true);
  });

  it("does not treat a latin ESG title as all three dimensions", () => {
    const draft = makeDraft({
      deliverableType: "report.esg",
      sections: [{ heading: "ESG Overview", body: "This note covers the year." }],
    });
    const report = validateDraftAgainstSpec(draft);
    const env = report.checks.find((c) => c.label.startsWith("环境"));
    const social = report.checks.find((c) => c.label.startsWith("社会"));
    const gov = report.checks.find((c) => c.label.startsWith("治理"));
    expect(env?.passed).toBe(false);
    expect(social?.passed).toBe(false);
    expect(gov?.passed).toBe(false);
  });

  it("warns when a calculated amount has no formula", () => {
    const draft = makeDraft({
      deliverableType: "labor.calc",
      sections: [
        { heading: "定性", body: "违法解除。" },
        { heading: "计算", body: "补偿 60000 元。" },
        { heading: "结论", body: "应付 60000 元。" },
      ],
    });
    const report = validateDraftAgainstSpec(draft);
    const calc = report.checks.find((c) => c.key === "calc.formula_source");
    expect(calc?.passed).toBe(false);
    expect(calc?.severity).toBe("warning");
    expect(report.ready).toBe(true);
  });

  it("accepts a calculated amount that cites a formula", () => {
    const draft = makeDraft({
      deliverableType: "labor.calc",
      sections: [
        { heading: "定性", body: "违法解除。" },
        { heading: "计算", body: "公式：3 × 10000 × 2 = 60000 元。" },
        { heading: "结论", body: "应付 60000 元。" },
      ],
    });
    expect(
      validateDraftAgainstSpec(draft).checks.find((c) => c.key === "calc.formula_source"),
    ).toBeUndefined();
  });

  it("warns on an exhibit list without a proof purpose", () => {
    const draft = makeDraft({
      deliverableType: "matter.exhibit_list",
      sections: [{ heading: "证据目录", body: "1. 租赁合同" }],
    });
    expect(
      validateDraftAgainstSpec(draft).checks.find((c) => c.key === "exhibit.purpose")?.passed,
    ).toBe(false);
  });

  it("warns when a complaint uses a markdown table", () => {
    const draft = makeDraft({
      deliverableType: "litigation.complaint",
      sections: [
        { heading: "当事人", body: "原告甲，被告乙。" },
        { heading: "诉讼请求", body: "判令支付租金。" },
        { heading: "事实与理由", body: "| 要件 | 事实 |\n| --- | --- |\n| 合同 | 已签 |" },
        { heading: "证据", body: "合同原件。" },
      ],
    });
    expect(
      validateDraftAgainstSpec(draft).checks.find((c) => c.key === "complaint.linear_columns")
        ?.passed,
    ).toBe(false);
  });
});
