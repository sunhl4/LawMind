import { describe, expect, it } from "vitest";
import {
  bindLawyerCapability,
  formatBoundCapabilityBlock,
  readSkillPromptBodies,
} from "./lawyer-capabilities.js";
import { planLeanSkillPrompt, primarySkillIdsForBound } from "./skill-prompt-budget.js";

describe("skill-prompt-budget", () => {
  it("injects two review skill bodies and indexes the rest", () => {
    const bound = bindLawyerCapability({ instruction: "请审查合同条款" });
    expect(bound).toBeTruthy();
    const lean = planLeanSkillPrompt(bound!, "请审查合同条款");
    expect(lean.primaryIds).toEqual(["contract-review-layers", "contract-redline-craft"]);
    expect(lean.indexIds).toContain("legal-element-extraction");
    const bodies = readSkillPromptBodies(undefined, lean.primaryIds);
    expect(bodies.some((b) => b.includes("合同分层审查"))).toBe(true);
    expect(bodies.some((b) => b.includes("合同审阅改稿手艺"))).toBe(true);
    expect(bodies.some((b) => b.includes("## 九类事实"))).toBe(false);
    const block = formatBoundCapabilityBlock(bound!, bodies, { indexLines: lean.indexLines });
    expect(block).toContain("其余技能（索引，不要通读）");
    expect(block).toContain("legal-element-extraction");
    expect(block).not.toContain("## 九类事实");
  });

  it("injects layers on mail and Word tracked paths", () => {
    const mail = bindLawyerCapability({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    });
    expect(primarySkillIdsForBound(mail!, "")).toEqual([
      "contract-review-layers",
      "citation-grounding",
    ]);

    const word = bindLawyerCapability({
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `合作协议.docx`",
        "修改合同",
      ].join("\n"),
    });
    expect(word?.pipeline).toBe("tracked_redline");
    expect(primarySkillIdsForBound(word!, "修改合同")).toEqual([
      "contract-review-layers",
      "contract-redline-craft",
    ]);
  });

  it("picks complaint fill for 起诉状 litigation", () => {
    const bound = bindLawyerCapability({ instruction: "写起诉状" });
    expect(bound?.id).toBe("litigation.draft");
    expect(primarySkillIdsForBound(bound!, "写起诉状")).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
  });

  it("non-contract skills carry 交件量规 in the injected body", () => {
    const samples: Array<{ instruction: string; needle: string }> = [
      { instruction: "他一直拖欠工资这算不算违法", needle: "交件量规" },
      { instruction: "写一封催款律师函", needle: "交件量规（函件）" },
      { instruction: "查一下民法典违约责任", needle: "交件量规" },
      { instruction: "写起诉状", needle: "交件量规" },
    ];
    for (const row of samples) {
      const bound = bindLawyerCapability({ instruction: row.instruction });
      expect(bound, row.instruction).toBeTruthy();
      const lean = planLeanSkillPrompt(bound!, row.instruction);
      const bodies = readSkillPromptBodies(undefined, lean.primaryIds);
      expect(
        bodies.some((b) => b.includes(row.needle)),
        row.instruction,
      ).toBe(true);
    }
  });
});
