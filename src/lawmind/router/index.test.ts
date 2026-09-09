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
    expect(intent.deliverableType).toBe("letter.demand");
    expect(intent.riskLevel).toBe("high");
    expect(intent.output).toBe("docx");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("maps 起草催告函 to draft.word letter.demand", () => {
    const intent = route({ instruction: "起草催告函" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("letter.demand");
  });

  it("does not route 研究合同违约催告 to contract.review", () => {
    const intent = route({ instruction: "研究合同违约催告" });
    expect(intent.deliverableType).not.toBe("contract.review");
    expect(intent.kind).not.toBe("analyze.contract");
  });

  it("maps everyday lawyer drafts by what they typed", () => {
    expect(route({ instruction: "起草一份律师函" }).deliverableType).toBe("letter.counsel");
    expect(route({ instruction: "写一封回函" }).deliverableType).toBe("letter.reply");
    expect(route({ instruction: "写起诉状" }).deliverableType).toBe("litigation.complaint");
    expect(route({ instruction: "写答辩状" }).deliverableType).toBe("litigation.answer");
    expect(route({ instruction: "写代理词" }).deliverableType).toBe("litigation.brief");
    expect(route({ instruction: "写一份法律意见书" }).deliverableType).toBe("memo.opinion");
    expect(route({ instruction: "出具法律意见" }).kind).toBe("draft.word");
    expect(route({ instruction: "出具法律意见" }).deliverableType).toBe("memo.opinion");
    expect(route({ instruction: "写一份内部备忘录" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "整理案件时间线" }).deliverableType).toBe("matter.timeline");
    expect(route({ instruction: "列证据目录" }).deliverableType).toBe("matter.exhibit_list");
    expect(route({ instruction: "写一份债权申报" }).deliverableType).toBe("document.general");
    expect(route({ instruction: "取保候审申请怎么写" }).deliverableType).toBe("litigation.outline");
    expect(route({ instruction: "写会议纪要" }).deliverableType).toBe("meeting.minutes");
    expect(route({ instruction: "写一份保密协议" }).deliverableType).toBe("contract.nda");
    expect(route({ instruction: "请写一份起诉状诉讼大纲" }).deliverableType).toBe(
      "litigation.outline",
    );
    expect(route({ instruction: "计算违法解除的经济补偿" }).deliverableType).toBe("labor.calc");
    expect(route({ instruction: "计算上诉期届满日" }).deliverableType).toBe("period.calc");
    expect(route({ instruction: "整理这些进项发票" }).kind).toBe("draft.word");
    expect(route({ instruction: "整理这些进项发票" }).deliverableType).toBe("document.general");
    expect(route({ instruction: "把法院短信里的开庭时间整理出来" }).kind).toBe("draft.word");
    expect(route({ instruction: "把法院短信里的开庭时间整理出来" }).deliverableType).toBe(
      "matter.timeline",
    );
    expect(route({ instruction: "这份专利侵权材料怎么主张" }).deliverableType).toBe(
      "litigation.outline",
    );
    expect(route({ instruction: "做一份股权收购尽调提纲" }).deliverableType).toBe("report.general");
    expect(route({ instruction: "出一份数据合规备忘" }).deliverableType).toBe("report.compliance");
    expect(route({ instruction: "出一份广告合规备忘" }).deliverableType).toBe("report.general");
    expect(route({ instruction: "写上诉状" }).deliverableType).toBe("document.general");
    expect(route({ instruction: "写一份执行异议" }).deliverableType).toBe("document.general");
    expect(route({ instruction: "列立案材料清单" }).deliverableType).toBe("document.general");
    expect(route({ instruction: "写本案办案周报" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "写一份结案备忘" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "写一份本地顾问对接" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "写办案人力安排" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "写干系人沟通计划" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "这份离婚诉讼材料怎么主张抚养权" }).deliverableType).toBe(
      "litigation.outline",
    );
    expect(route({ instruction: "核对招股说明书信息披露备忘" }).deliverableType).toBe(
      "report.general",
    );
    expect(route({ instruction: "起草这份董事会决议" }).deliverableType).toBe("memo.internal");
    expect(route({ instruction: "他一直拖欠工资这算不算违法" }).deliverableType).toBe(
      "memo.internal",
    );
    expect(route({ instruction: "他一直拖欠工资这算不算违法" }).kind).toBe("research.legal");
  });

  it("does not treat a contract with 催告条款 as a demand letter", () => {
    const intent = route({ instruction: "起草一份带催告条款的服务合同" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("contract.general");
  });

  it("maps 修改合同 to draft.word body edit instead of opinion review", () => {
    const intent = route({
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
        "修改合同",
      ].join("\n"),
    });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("contract.general");
  });

  it("maps 起草合同 to draft.word instead of contract review", () => {
    const intent = route({ instruction: "请起草一份租赁合同" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("contract.rental");
    expect(intent.output).toBe("docx");
    expect(intent.riskLevel).toBe("high");
    expect(intent.clarificationQuestions?.length).toBeGreaterThan(0);
  });

  it("maps ESG report instructions to report.esg", () => {
    const intent = route({ instruction: "起草一份 2025 年度 ESG 可持续发展报告" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.esg");
  });

  it("maps EU new energy vehicle ESG report to report.esg", () => {
    const intent = route({
      instruction: "写一份详细的欧盟新能源汽车相关 ESG 报告",
    });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.esg");
  });

  it("maps diligence report to report.general", () => {
    const intent = route({ instruction: "撰写目标公司尽职调查报告初稿" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.general");
  });

  it("maps compliance dossier language to report.compliance", () => {
    const intent = route({
      instruction: "请输出涉外合规卷宗备忘录，覆盖管辖区效力矩阵与 URL 来源附录",
    });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.compliance");
  });

  it("keeps NEV EU export compliance dossier as report.compliance (not ESG)", () => {
    const intent = route({
      instruction:
        "【交办】合规研究卷宗\n交付物类型代码：report.compliance\n监管问题：新能源汽车中国内地出口欧盟合规",
    });
    expect(intent.deliverableType).toBe("report.compliance");
  });

  it("maps NEV EU compliance research volume language to report.compliance", () => {
    const intent = route({
      instruction: "请撰写新能源汽车出口欧盟的涉外合规卷宗备忘录，含管辖区效力矩阵",
    });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.compliance");
  });

  it("honors locked deliverableType preset over ESG keywords", () => {
    const intent = route({
      instruction: "欧盟新能源汽车出口合规与碳中和披露背景材料",
      deliverableType: "report.compliance",
    });
    expect(intent.deliverableType).toBe("report.compliance");
  });

  it("maps learning brief language to report.learning", () => {
    const intent = route({ instruction: "写一份学习型调研简报：个人信息保护法制度要点" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.deliverableType).toBe("report.learning");
  });

  it("maps training deck language to ppt.training", () => {
    const intent = route({ instruction: "做一份客户合规培训 PPT，受众是法务，时长 30 分钟" });
    expect(intent.kind).toBe("draft.ppt");
    expect(intent.deliverableType).toBe("ppt.training");
  });

  it("keeps client brief PPT without forcing ppt.training", () => {
    const intent = route({ instruction: "做一份客户汇报的PPT" });
    expect(intent.kind).toBe("draft.ppt");
    expect(intent.deliverableType).toBeUndefined();
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
