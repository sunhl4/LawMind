import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "../agent/context-budget.js";
import { FRAGMENT_CAPS, scaleFragmentCapTokens } from "../agent/prompt-fragments.js";
import {
  bindLawyerCapability,
  formatBoundCapabilityBlock,
  listLawyerCapabilities,
  readBuiltinSkillMarkdown,
  readSkillPromptBodies,
} from "./lawyer-capabilities.js";
import {
  INVARIANT_SKILL_IDS,
  orderedSkillIdsForBound,
  planLeanSkillPrompt,
  primarySkillIdsForBound,
  structuralTargetIdsFor,
} from "./skill-prompt-budget.js";

describe("skill-prompt-budget", () => {
  it("injects the review specs plus cross-cutting invariants, indexes the rest", () => {
    const bound = bindLawyerCapability({ instruction: "请审查合同条款" });
    expect(bound).toBeTruthy();
    const lean = planLeanSkillPrompt(bound!, "请审查合同条款");
    expect(lean.primaryIds).toEqual([
      "contract-review-layers",
      "contract-playbook-review",
      "citation-grounding",
      "norm-validity",
      "legal-element-extraction",
    ]);
    // 只服务 tracked 改稿的手艺、以及系统提示词已覆盖的全局交付用语，留在索引里。
    expect(lean.indexIds).toContain("contract-redline-craft");
    expect(lean.indexIds).toContain("delivery-language");
    expect(lean.indexIds).toContain("practice-defaults");

    const bodies = readSkillPromptBodies(undefined, lean.primaryIds);
    expect(bodies.some((b) => b.includes("合同分层审查"))).toBe(true);
    expect(bodies.some((b) => b.includes("合同 Playbook 审查"))).toBe(true);
    expect(bodies.some((b) => b.includes("合同审阅改稿手艺"))).toBe(false);

    const block = formatBoundCapabilityBlock(bound!, bodies, { indexLines: lean.indexLines });
    expect(block).toContain("其余技能（索引，不要通读）");
    expect(block).toContain("contract-redline-craft");
    // 索引行只披露简介，不夹带正文。
    expect(block).not.toContain("合同审阅改稿手艺（Craft）");
  });

  it("never hands the packer a body it would slice mid-sentence", () => {
    // 回归：旧实现固定注入 2 篇，contract.review 实测 2,395 token > 2,000 帽，
    // `capFragmentBody` 于是把 Playbook 后半截切掉（法律规则被切成半句）。
    for (const cap of listLawyerCapabilities()) {
      const lean = planLeanSkillPrompt({ ...cap, deliverableType: undefined }, "");
      const block = formatBoundCapabilityBlock(
        { ...cap, deliverableType: undefined },
        readSkillPromptBodies(undefined, lean.primaryIds),
        { indexLines: lean.indexLines },
      );
      expect(estimateTextTokens(block), `${cap.id} block`).toBe(lean.estimatedTokens);
      expect(lean.capTokens, `${cap.id} cap`).toBeGreaterThanOrEqual(lean.estimatedTokens);
      expect(lean.capTokens, `${cap.id} cap floor`).toBeGreaterThanOrEqual(
        FRAGMENT_CAPS.skill_index.capTokens,
      );
    }
  });

  it("keeps unrelated stage routes out of the injected target", () => {
    // 民事起诉状回合不该带上刑辩/家事/破产的阶段路由——那是旧「能塞多少塞多少」
    // 与「能力前两篇」两种写法都可能犯的错。
    const complaint = bindLawyerCapability({ instruction: "写起诉状" });
    const target = structuralTargetIdsFor(complaint!, "写起诉状");
    expect(target).toContain("complaint-elements-fill");
    expect(target).toContain("evidence-argument-chain");
    expect(target).not.toContain("criminal-stage-route");
    expect(target).not.toContain("bankruptcy-stage-route");
    expect(target).not.toContain("family-matter-route");
  });

  it("injects layers and invariants on mail and Word tracked paths", () => {
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
    const wordTarget = primarySkillIdsForBound(word!, "修改合同");
    // 改稿回合必须先给分层审查与最短锚定手艺；其后才是引用/效力/要素不变量。
    expect(wordTarget.slice(0, 2)).toEqual(["contract-review-layers", "contract-redline-craft"]);
    expect(wordTarget).toContain("citation-grounding");
  });

  it("picks complaint fill for 起诉状 litigation", () => {
    const bound = bindLawyerCapability({ instruction: "写起诉状" });
    expect(bound?.id).toBe("litigation.draft");
    const target = primarySkillIdsForBound(bound!, "写起诉状");
    expect(target.slice(0, 2)).toEqual(["complaint-elements-fill", "evidence-argument-chain"]);
  });

  it("does not inject the complaint template when the complaint is only the source", () => {
    const bound = bindLawyerCapability({ instruction: "根据起诉状写答辩状" });
    expect(bound?.id).toBe("litigation.draft");
    const target = primarySkillIdsForBound(bound!, "根据起诉状写答辩状");
    expect(target.slice(0, 2)).toEqual(["litigation-stage-route", "evidence-argument-chain"]);
    expect(target).not.toContain("complaint-elements-fill");
  });

  it("keeps the complaint template when 答辩状 is only the source", () => {
    const instruction = "针对被告的答辩状写一份起诉状";
    const bound = bindLawyerCapability({ instruction });
    expect(bound?.id).toBe("litigation.draft");
    const target = primarySkillIdsForBound(bound!, instruction);
    expect(target.slice(0, 2)).toEqual(["complaint-elements-fill", "evidence-argument-chain"]);
  });

  it("does not inject the complaint template for 答辩状", () => {
    const bound = bindLawyerCapability({ instruction: "写答辩状" });
    expect(bound?.id).toBe("litigation.draft");
    const target = primarySkillIdsForBound(bound!, "写答辩状");
    expect(target.slice(0, 2)).toEqual(["litigation-stage-route", "evidence-argument-chain"]);
    expect(target).not.toContain("complaint-elements-fill");
  });

  it("injects both timeline skills and the status scope skill", () => {
    const timeline = bindLawyerCapability({ instruction: "把这些材料做成时间轴" });
    const timelineTarget = primarySkillIdsForBound(timeline!, "把这些材料做成时间轴");
    expect(timelineTarget.slice(0, 2)).toEqual([
      "chronology-two-stage",
      "chronology-from-materials",
    ]);
    // 两段式时间轴自己就要先做事实净化，要素不变量在这里也应注入。
    expect(timelineTarget).toContain("legal-element-extraction");

    const status = bindLawyerCapability({ instruction: "写本案办案周报" });
    expect(primarySkillIdsForBound(status!, "写本案办案周报")).toEqual([
      "matter-status-report",
      "matter-status-scope-budget",
    ]);
  });

  it("orders the target before the remaining candidates, with no duplicates", () => {
    for (const cap of listLawyerCapabilities()) {
      const bound = { ...cap, deliverableType: undefined };
      const ordered = orderedSkillIdsForBound(bound, "");
      const target = structuralTargetIdsFor(bound, "");
      expect(new Set(ordered).size, `${cap.id} duplicates`).toBe(ordered.length);
      expect(ordered.slice(0, target.length), `${cap.id} head`).toEqual(target);
      expect(ordered.length, `${cap.id} covers all skills`).toBe(cap.skillIds.length);
    }
  });

  it("only uses invariant ids that exist and are declared by their capability", () => {
    for (const id of INVARIANT_SKILL_IDS) {
      expect(readBuiltinSkillMarkdown(id), `${id} should ship`).toBeTruthy();
    }
    const used = new Set<string>();
    for (const cap of listLawyerCapabilities()) {
      for (const id of cap.skillIds) {
        if (INVARIANT_SKILL_IDS.includes(id)) {
          used.add(id);
        }
      }
    }
    // 死条目会让「不变量」看起来生效、实际没有任何能力引用它。
    expect([...used].toSorted()).toEqual([...INVARIANT_SKILL_IDS].toSorted());
  });

  it("honours an explicit cap without changing the target", () => {
    const bound = bindLawyerCapability({ instruction: "请审查合同条款" });
    const lean = planLeanSkillPrompt(bound!, "请审查合同条款", { capTokens: 1_000 });
    // 取舍由结构目标决定；小帽只影响 `capTokens`（保证不切半篇），不减少正文。
    expect(lean.primaryIds).toEqual(structuralTargetIdsFor(bound!, "请审查合同条款"));
    expect(lean.capTokens).toBe(lean.estimatedTokens);
    expect(lean.capTokens).toBeGreaterThan(1_000);
    expect(scaleFragmentCapTokens("skill_index")).toBe(FRAGMENT_CAPS.skill_index.capTokens);
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
