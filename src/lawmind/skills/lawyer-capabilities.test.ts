import { describe, expect, it } from "vitest";
import {
  bindLawyerCapability,
  formatBoundCapabilityBlock,
  listLawyerCapabilities,
  readBuiltinSkillMarkdown,
  readSkillPromptBodies,
} from "./lawyer-capabilities.js";

describe("lawyer-capabilities", () => {
  it("lists the high-frequency productized capabilities", () => {
    const ids = listLawyerCapabilities().map((c) => c.id);
    expect(ids).toEqual([
      "contract.review",
      "letter.draft",
      "research.memo",
      "litigation.draft",
      "materials.draft",
      "mail.contract",
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

  it("formats a productized prompt block with builtin skills", () => {
    const bound = bindLawyerCapability({ instruction: "请审查合同条款" });
    expect(bound).toBeTruthy();
    const bodies = readSkillPromptBodies(undefined, bound!.skillIds);
    expect(bodies.some((b) => b.includes("合同审阅改稿手艺"))).toBe(true);
    const block = formatBoundCapabilityBlock(bound!, bodies);
    expect(block).toContain("本轮 LawMind 能力：合同审查");
    expect(block).toContain("产品化办件");
    expect(block).toContain("execute_workflow");
    expect(block).toContain("办件");
  });

  it("reads builtin skill markdown", () => {
    expect(readBuiltinSkillMarkdown("delivery-language")).toContain("交付用语");
    expect(readBuiltinSkillMarkdown("missing-skill")).toBeNull();
  });
});
