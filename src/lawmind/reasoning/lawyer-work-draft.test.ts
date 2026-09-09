import { describe, expect, it } from "vitest";
import { validateDraftAgainstSpec } from "../deliverables/validator.js";
import { route } from "../router/index.js";
import type { ResearchBundle } from "../types.js";
import { buildDraft } from "./keyword-draft.js";

function emptyBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "",
    claims: [],
    sources: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("keyword-draft lawyer-work scaffolds", () => {
  it.each([
    ["起草一份律师函", "letter.counsel"],
    ["写起诉状", "litigation.complaint"],
    ["计算违法解除的经济补偿", "labor.calc"],
    ["计算上诉期届满日", "period.calc"],
    ["写一份法律意见书", "memo.opinion"],
    ["出具法律意见", "memo.opinion"],
    ["写一封回函", "letter.reply"],
    ["写一份保密协议", "contract.nda"],
    ["起草催告函", "letter.demand"],
    ["写一封催款律师函", "letter.demand"],
  ] as const)("%s scaffolds a %s draft without throwing", (instruction, type) => {
    const intent = route({ instruction });
    expect(intent.deliverableType).toBe(type);
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    expect(draft.deliverableType).toBe(type);
    expect(draft.sections.length).toBeGreaterThan(2);
    const report = validateDraftAgainstSpec(draft);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it("fills letter.demand headings required by the spec", () => {
    const intent = route({ instruction: "起草催告函" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const headings = draft.sections.map((s) => s.heading).join(" ");
    expect(headings).toMatch(/收函/);
    expect(headings).toMatch(/事实/);
    expect(headings).toMatch(/主张/);
    expect(headings).toMatch(/期限/);
    expect(headings).toMatch(/后果/);
    expect(headings).toMatch(/落款/);

    const named = buildDraft({
      intent: route({
        instruction: "起草催告函。致：某科技有限公司。委托人：张三。",
      }),
      bundle: emptyBundle("t-demand-named"),
    });
    const namedBody = named.sections.map((s) => s.body).join("\n");
    expect(namedBody).toContain("某科技有限公司");
    expect(namedBody).toContain("张三");
  });

  it("complaint scaffold is linear elements not a markdown table", () => {
    const intent = route({ instruction: "写起诉状" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const joined = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    expect(joined).toMatch(/证据对照/);
    expect(joined).toMatch(/要件：/);
    expect(joined).toMatch(/证明力/);
    expect(joined).not.toMatch(/\| --- \|/);
  });

  it("research memo scaffold has for-and-against case columns", () => {
    const intent = route({ instruction: "查一下民法典违约责任" });
    expect(intent.deliverableType).toBe("memo.research");
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const headings = draft.sections.map((s) => s.heading).join(" ");
    expect(headings).toMatch(/命题/);
    expect(headings).toMatch(/现行法条/);
    expect(headings).toMatch(/正向类案/);
    expect(headings).toMatch(/反向类案/);
    expect(headings).toMatch(/来源边界/);
    expect(headings).toMatch(/效力层级/);
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("违约金");
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("试检 1–2 条");
  });

  it("labor calc names arbitration-first and exhibit list uses the evidence chain", () => {
    const labor = buildDraft({
      intent: route({ instruction: "计算违法解除的经济补偿" }),
      bundle: emptyBundle("t-labor"),
    });
    expect(labor.sections.map((s) => s.heading).join(" ")).toMatch(/仲裁前置/);

    const laborFilled = buildDraft({
      intent: route({ instruction: "工作3年月薪10000，计算违法解除的经济补偿" }),
      bundle: emptyBundle("t-labor-n"),
    });
    expect(laborFilled.sections.map((s) => s.body).join("\n")).toContain("60000");
    expect(laborFilled.sections.map((s) => s.body).join("\n")).toContain("禁止口算");

    const laborArb = buildDraft({
      intent: route({
        instruction: "2024年1月1日被违法解除，工作3年月薪10000，计算经济补偿",
      }),
      bundle: emptyBundle("t-labor-arb"),
    });
    expect(laborArb.sections.map((s) => s.body).join("\n")).toContain("2025-01-01");
    expect(laborArb.sections.map((s) => s.body).join("\n")).not.toContain("calculate");

    const period = buildDraft({
      intent: route({ instruction: "2024年1月1日送达判决，计算上诉期届满日" }),
      bundle: emptyBundle("t-period"),
    });
    expect(period.deliverableType).toBe("period.calc");
    expect(period.sections.map((s) => s.body).join("\n")).toContain("2024-01-16");

    const timeline = buildDraft({
      intent: route({ instruction: "整理案件时间线：2024年1月1日签合同，2024年3月1日付款" }),
      bundle: emptyBundle("t-tl"),
    });
    expect(timeline.sections.map((s) => s.body).join("\n")).toContain("2024-01-01");
    expect(timeline.sections.map((s) => s.body).join("\n")).not.toMatch(/\| --- \|/);

    const exhibits = buildDraft({
      intent: route({ instruction: "列证据目录" }),
      bundle: emptyBundle("t-ex"),
    });
    expect(exhibits.sections.map((s) => s.body).join("\n")).toContain("证明力");
    expect(exhibits.sections.map((s) => s.body).join("\n")).not.toMatch(/\| --- \|/);

    const namedExhibits = buildDraft({
      intent: route({ instruction: "列证据目录，有劳动合同和工资流水" }),
      bundle: emptyBundle("t-ex-named"),
    });
    expect(namedExhibits.sections.map((s) => s.body).join("\n")).toContain("工资或银行流水");
    expect(namedExhibits.sections.map((s) => s.body).join("\n")).toContain("劳动合同");
  });

  it("complaint header records inferred 一审 stage", () => {
    const draft = buildDraft({
      intent: route({ instruction: "写起诉状" }),
      bundle: emptyBundle("t-complaint-stage"),
    });
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("阶段：一审");
  });

  it("quick-ask uses 要件事实 instead of a generic internal memo", () => {
    const intent = route({ instruction: "他一直拖欠工资这算不算违法" });
    expect(intent.deliverableType).toBe("memo.internal");
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const joined = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    expect(joined).toContain("要件事实");
    expect(joined).toContain("未及时足额支付劳动报酬");
    expect(joined).toContain("分诊：要干活");
    expect(validateDraftAgainstSpec(draft).checks.length).toBeGreaterThan(0);
  });

  it("criminal outline and bankruptcy filing stay off civil complaint templates", () => {
    const criminal = buildDraft({
      intent: route({ instruction: "取保候审申请怎么写" }),
      bundle: emptyBundle("t-crim"),
    });
    expect(criminal.deliverableType).toBe("litigation.outline");
    expect(criminal.sections.map((s) => s.body).join("\n")).toContain("不要套民事起诉状");

    const bankruptcy = buildDraft({
      intent: route({ instruction: "写一份债权申报" }),
      bundle: emptyBundle("t-bk"),
    });
    expect(bankruptcy.deliverableType).toBe("document.general");
    expect(bankruptcy.sections.map((s) => s.body).join("\n")).toContain("不要写成起诉状");
  });

  it("matter status uses LPM columns and close memo has a retrospective", () => {
    const status = buildDraft({
      intent: route({ instruction: "写本案办案周报" }),
      bundle: emptyBundle("t-status"),
    });
    const statusHead = status.sections.map((s) => s.heading).join(" ");
    expect(statusHead).toMatch(/进度/);
    expect(statusHead).toMatch(/置信/);
    expect(status.sections.map((s) => s.body).join("\n")).toContain("截止日期");

    const close = buildDraft({
      intent: route({ instruction: "写一份结案备忘" }),
      bundle: emptyBundle("t-close"),
    });
    expect(close.sections.map((s) => s.heading).join(" ")).toMatch(/范围回顾/);

    const local = buildDraft({
      intent: route({ instruction: "写一份本地顾问对接" }),
      bundle: emptyBundle("t-local"),
    });
    expect(local.title).toBe("本地顾问对接");
    expect(local.sections.map((s) => s.heading).join(" ")).toMatch(/工作包/);

    const resource = buildDraft({
      intent: route({ instruction: "写办案人力安排" }),
      bundle: emptyBundle("t-res"),
    });
    expect(resource.title).toBe("办案资源计划");

    const comms = buildDraft({
      intent: route({ instruction: "写干系人沟通计划" }),
      bundle: emptyBundle("t-comms"),
    });
    expect(comms.sections.map((s) => s.body).join("\n")).toContain("不是律师函");

    const issuance = buildDraft({
      intent: route({ instruction: "写一份待签发清单" }),
      bundle: emptyBundle("t-iss"),
    });
    expect(issuance.title).toBe("待签发清单");
    expect(issuance.sections.map((s) => s.body).join("\n")).toContain("不是审批页");
  });

  it("ads compliance and civil stage scaffolds stay off complaint and data-compliance", () => {
    const ads = buildDraft({
      intent: route({ instruction: "出一份广告合规备忘" }),
      bundle: emptyBundle("t-ads"),
    });
    expect(ads.title).toBe("广告与产品合规备忘");
    expect(ads.sections.map((s) => s.heading).join(" ")).toMatch(/用语/);
    expect(ads.sections.map((s) => s.body).join("\n")).toContain("不要写成数据出境备忘");

    const appeal = buildDraft({
      intent: route({ instruction: "写上诉状" }),
      bundle: emptyBundle("t-appeal"),
    });
    expect(appeal.title).toBe("民事上诉状");
    expect(appeal.sections.map((s) => s.body).join("\n")).toContain("不要写成一审起诉状");
    expect(appeal.sections.map((s) => s.body).join("\n")).toContain("阶段：上诉");

    const filing = buildDraft({
      intent: route({ instruction: "列立案材料清单" }),
      bundle: emptyBundle("t-file"),
    });
    expect(filing.sections.map((s) => s.heading).join(" ")).toMatch(/材料/);
  });

  it("family, capital and governance scaffolds stay off the mail/word paths", () => {
    const family = buildDraft({
      intent: route({ instruction: "这份离婚诉讼材料怎么主张抚养权" }),
      bundle: emptyBundle("t-fam"),
    });
    expect(family.sections.map((s) => s.heading).join(" ")).toMatch(/子女利益/);
    expect(family.sections.map((s) => s.heading).join(" ")).toMatch(/财产/);

    const capital = buildDraft({
      intent: route({ instruction: "核对招股说明书信息披露备忘" }),
      bundle: emptyBundle("t-cap"),
    });
    expect(capital.sections.map((s) => s.heading).join(" ")).toMatch(/数字来源/);
    expect(capital.sections.map((s) => s.heading).join(" ")).toMatch(/披露时点/);
    expect(capital.sections.map((s) => s.body).join("\n")).toContain("不是股权融资 Word 改稿");

    const gov = buildDraft({
      intent: route({ instruction: "起草这份董事会决议" }),
      bundle: emptyBundle("t-gov"),
    });
    expect(gov.sections.map((s) => s.heading).join(" ")).toMatch(/职权依据/);
    expect(gov.sections.map((s) => s.body).join("\n")).toContain("不代替章程 Word 红线");
  });

  it("rental scaffold is not ready while 【出租人】 placeholders remain", () => {
    const intent = route({ instruction: "请起草一份租赁合同" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(false);
    expect(report.placeholderSamples.join("")).toContain("【出租人");
  });

  it("letter.demand becomes ready only after placeholders are filled", () => {
    const intent = route({ instruction: "起草催告函" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const filled = {
      ...draft,
      sections: draft.sections.map((s) => ({
        ...s,
        body: s.body.replace(/【[^】]+】/g, "已填写事项"),
      })),
    };
    const report = validateDraftAgainstSpec(filled);
    expect(
      report.ready,
      report.checks
        .filter((c) => !c.passed)
        .map((c) => c.label)
        .join("; "),
    ).toBe(true);
  });
});
