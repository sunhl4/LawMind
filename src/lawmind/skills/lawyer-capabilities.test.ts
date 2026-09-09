import { describe, expect, it } from "vitest";
import {
  bindLawyerCapability,
  formatBoundCapabilityBlock,
  listLawyerCapabilities,
  readBuiltinSkillMarkdown,
  readSkillPromptBodies,
} from "./lawyer-capabilities.js";
import { planLeanSkillPrompt } from "./skill-prompt-budget.js";

describe("lawyer-capabilities", () => {
  it("lists the high-frequency productized capabilities", () => {
    const ids = listLawyerCapabilities().map((c) => c.id);
    expect(ids).toEqual([
      "contract.review",
      "letter.draft",
      "research.memo",
      "litigation.draft",
      "litigation.talk",
      "materials.draft",
      "mail.contract",
      "analysis.quick",
      "contract.draft",
      "labor.calc",
      "chronology.timeline",
      "matter.intake",
      "period.calc",
      "ops.invoice",
      "ops.court_sms",
      "ip.dispute",
      "deal.ma",
      "compliance.data",
      "compliance.ads",
      "matter.status",
      "family.matter",
      "capital.markets",
      "corp.governance",
    ]);
  });

  it("binds contract review and letter draft from natural language", () => {
    const review = bindLawyerCapability({ instruction: "请审查这份采购合同的违约责任" });
    expect(review?.id).toBe("contract.review");
    expect(review?.deliverableType).toBe("contract.review");

    const letter = bindLawyerCapability({ instruction: "写一封催款律师函" });
    expect(letter?.id).toBe("letter.draft");
    expect(letter?.deliverableType).toBe("letter.demand");
  });

  it("binds research when there is no deliverable type yet", () => {
    const research = bindLawyerCapability({ instruction: "查一下民法典违约责任" });
    expect(research?.id).toBe("research.memo");
  });

  it("binds mail contract from the short-path marker", () => {
    const mail = bindLawyerCapability({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    });
    expect(mail?.id).toBe("mail.contract");
  });

  it("binds file-page 修改合同 to tracked redline, not mail", () => {
    const bound = bindLawyerCapability({
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
        "修改合同",
      ].join("\n"),
    });
    expect(bound?.pipeline).toBe("tracked_redline");
    expect(bound?.deliverableType).toBe("contract.general");
    expect(bound?.pipelineHint).toContain("render_tracked_draft");
    expect(bound?.pipelineHint).toContain("不要准备外发邮件");
    expect(bound?.skillIds).toEqual(["contract-redline-craft"]);
    expect(bound?.skillIds).not.toContain("contract-review-layers");
  });

  it("binds dialog 导出 to tracked redline when a Word is pinned", () => {
    const bound = bindLawyerCapability({
      instruction: "立场甲方，导出",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "泰国医疗人工智能战略合作框架协议.docx",
          kind: "file",
        },
      ],
    });
    expect(bound?.pipeline).toBe("tracked_redline");
    expect(bound?.deliverableType).toBe("contract.general");
    expect(bound?.skillIds).toEqual(["contract-redline-craft"]);
  });

  it("honors an explicit 办件 lock over keywords", () => {
    const locked = bindLawyerCapability({
      instruction: "【办件】能力：letter.draft\n流程：函件起草\n请按已附材料与钉源执行该流程。",
    });
    expect(locked?.id).toBe("letter.draft");
    expect(locked?.deliverableType).toBe("letter.counsel");
  });

  it("does not bind greeting or identity questions", () => {
    expect(bindLawyerCapability({ instruction: "你好" })).toBeNull();
    expect(bindLawyerCapability({ instruction: "你是什么模型" })).toBeNull();
  });

  it("binds drafting, labor calc, chronology, intake and quick questions", () => {
    expect(bindLawyerCapability({ instruction: "请起草一份租赁合同" })?.id).toBe("contract.draft");
    expect(bindLawyerCapability({ instruction: "计算违法解除的经济补偿" })?.id).toBe("labor.calc");
    expect(bindLawyerCapability({ instruction: "计算上诉期届满日" })?.id).toBe("period.calc");
    expect(bindLawyerCapability({ instruction: "整理这些进项发票" })?.id).toBe("ops.invoice");
    expect(bindLawyerCapability({ instruction: "把法院短信里的开庭时间整理出来" })?.id).toBe(
      "ops.court_sms",
    );
    expect(bindLawyerCapability({ instruction: "这份专利侵权材料怎么主张" })?.id).toBe(
      "ip.dispute",
    );
    expect(bindLawyerCapability({ instruction: "做一份股权收购尽调提纲" })?.id).toBe("deal.ma");
    expect(bindLawyerCapability({ instruction: "出一份数据合规备忘，涉及数据出境" })?.id).toBe(
      "compliance.data",
    );
    expect(bindLawyerCapability({ instruction: "出一份广告合规备忘" })?.id).toBe("compliance.ads");
    expect(bindLawyerCapability({ instruction: "写上诉状" })?.id).toBe("litigation.draft");
    expect(bindLawyerCapability({ instruction: "写一份执行异议" })?.id).toBe("litigation.draft");
    expect(bindLawyerCapability({ instruction: "列立案材料清单" })?.id).toBe("litigation.draft");
    expect(bindLawyerCapability({ instruction: "写一份待签发清单" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写事项协作建议" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写本案办案周报" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写一份结案备忘" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写一份本地顾问对接" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写办案人力安排" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "写干系人沟通计划" })?.id).toBe("matter.status");
    expect(bindLawyerCapability({ instruction: "这份离婚诉讼材料怎么主张抚养权" })?.id).toBe(
      "family.matter",
    );
    expect(bindLawyerCapability({ instruction: "核对招股说明书信息披露备忘" })?.id).toBe(
      "capital.markets",
    );
    expect(bindLawyerCapability({ instruction: "起草这份董事会决议" })?.id).toBe("corp.governance");
    expect(bindLawyerCapability({ instruction: "写一份债权申报" })?.id).toBe("litigation.draft");
    expect(bindLawyerCapability({ instruction: "写一份债权申报" })?.skillIds).toContain(
      "bankruptcy-stage-route",
    );
    expect(bindLawyerCapability({ instruction: "请审查这份公司章程条款的表决比例" })?.id).toBe(
      "contract.review",
    );
    expect(bindLawyerCapability({ instruction: "整理案件时间线" })?.id).toBe("chronology.timeline");
    expect(bindLawyerCapability({ instruction: "整理这个案件材料并建立目录" })?.id).toBe(
      "matter.intake",
    );
    expect(bindLawyerCapability({ instruction: "他一直拖欠工资这算不算违法" })?.id).toBe(
      "analysis.quick",
    );
    const brief = bindLawyerCapability({ instruction: "写辩护词" });
    expect(brief?.id).toBe("litigation.draft");
    expect(brief?.skillIds).toContain("criminal-stage-route");
    expect(brief?.skillIds).toContain("family-matter-route");
    expect(brief?.skillIds).toContain("bankruptcy-stage-route");
    expect(bindLawyerCapability({ instruction: "整理这个案件材料并建立目录" })?.skillIds).toContain(
      "matter-budget-lite",
    );
  });

  it("keeps mail.contract skill list short so the short path stays intact", () => {
    const mail = bindLawyerCapability({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    });
    expect(mail?.id).toBe("mail.contract");
    expect(mail?.skillIds).toEqual(["citation-grounding", "delivery-language"]);
  });

  it("formats a productized prompt block with builtin skills", () => {
    const bound = bindLawyerCapability({ instruction: "请审查合同条款" });
    expect(bound).toBeTruthy();
    const bodies = readSkillPromptBodies(undefined, bound!.skillIds);
    expect(bodies.some((b) => b.includes("合同审阅改稿手艺"))).toBe(true);
    expect(bodies.some((b) => b.includes("合同分层审查"))).toBe(true);
    const lean = planLeanSkillPrompt(bound!, "请审查合同条款");
    const leanBodies = readSkillPromptBodies(undefined, lean.primaryIds);
    expect(lean.primaryIds.length).toBeLessThanOrEqual(2);
    expect(leanBodies.some((b) => b.includes("合同分层审查"))).toBe(true);
    expect(leanBodies.some((b) => b.includes("合同审阅改稿手艺"))).toBe(true);
    expect(leanBodies.some((b) => b.includes("## 九类事实"))).toBe(false);
    const block = formatBoundCapabilityBlock(bound!, leanBodies, { indexLines: lean.indexLines });
    expect(block).toContain("本轮 LawMind 能力：合同审查");
    expect(block).toContain("产品化办件");
    expect(block).toContain("execute_workflow");
    expect(block).toContain("办件");
    expect(block).toContain("其余技能（索引，不要通读）");
    expect(block).toContain("legal-element-extraction");
  });

  it("reads builtin skill markdown", () => {
    expect(readBuiltinSkillMarkdown("delivery-language")).toContain("交付用语");
    expect(readBuiltinSkillMarkdown("missing-skill")).toBeNull();
  });
});
