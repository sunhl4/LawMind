import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { runLegalLint } from "./run-lint.js";
import {
  applySelfReviseToDraft,
  classifyResidual,
  previewSelfRevise,
  runSelfRevise,
} from "./self-revise.js";

describe("runSelfRevise", () => {
  it("proposes a deposit-cap fix but never rewrites statutory terms on its own", () => {
    const text = "第一条 定金为本合同标的额的 30%。双方按约履行。";
    const first = runLegalLint(text);
    expect(first.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
    expect(first.findings.find((f) => f.ruleId === "statutory.deposit_cap")?.severity).toBe(
      "blocker",
    );

    const revised = runSelfRevise(text, first);
    // 法定参数类不自动改：原文保留 30%，只产出带法条依据的建议式提案。
    expect(revised.applied.some((a) => a.ruleId === "statutory.deposit_cap")).toBe(false);
    expect(revised.text).toContain("30%");
    const proposal = revised.proposals.find((p) => p.ruleId === "statutory.deposit_cap");
    expect(proposal).toBeDefined();
    expect(proposal?.requiresLawyerDecision).toBe(true);
    expect(proposal?.statuteBasis).toBe("民法典第586条");
    expect(proposal?.before).toContain("30%");
    expect(proposal?.after).toContain("20%");
    expect(revised.summaryZh).toContain("格式规范化");
    expect(revised.summaryZh).toContain("法定参数");
    expect(revised.summaryZh).toContain("不代改原文");

    // 原文未改，定金 blocker 仍在 residual 中等待律师定夺。
    expect(revised.residual.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
    expect(revised.residualSubjective.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
  });

  it("suggests the Chinese-numeral cap form for 百分之X deposits", () => {
    const revised = runSelfRevise("第一条 定金为本合同标的额的百分之三十。双方按约履行。");
    const proposal = revised.proposals.find((p) => p.ruleId === "statutory.deposit_cap");
    expect(proposal?.before).toContain("百分之三十");
    expect(proposal?.after).toContain("百分之二十");
    expect(revised.text).toContain("百分之三十");
  });

  it("still auto-applies whitespace-class normalization", () => {
    const revised = runSelfRevise("第一条　双方按约履行，条款完整无缺陷表述。");
    expect(revised.applied.some((a) => a.ruleId === "normalize.fullwidth_space")).toBe(true);
    expect(revised.text).not.toContain("　");
  });

  it("leaves or-arbitrate residual and does not pick a forum", () => {
    const text = "争议解决：双方既可以申请仲裁也可以向人民法院起诉。其余条款按约定。";
    const revised = runSelfRevise(text);
    expect(revised.applied.some((a) => a.ruleId === "form.or_arbitrate_or_sue")).toBe(false);
    expect(revised.text).toContain("既可以申请仲裁也可以向人民法院起诉");
    expect(revised.text).not.toContain("北京仲裁");
    expect(revised.residual.some((f) => f.ruleId === "form.or_arbitrate_or_sue")).toBe(true);
  });

  it("is a no-op for empty or short text", () => {
    expect(runSelfRevise("")).toMatchObject({ rounds: 0, applied: [], residual: [], text: "" });
    expect(previewSelfRevise("定金30%").rounds).toBe(0);
    expect(previewSelfRevise("短稿").applied).toEqual([]);
  });

  it("classifies or-arbitrate as subjective residual", () => {
    const revised = runSelfRevise(
      "争议解决：双方既可以申请仲裁也可以向人民法院起诉。其余条款按约定。",
    );
    expect(revised.residualSubjective.some((f) => f.ruleId === "form.or_arbitrate_or_sue")).toBe(
      true,
    );
    expect(classifyResidual(revised.residual).residualSubjective.length).toBeGreaterThan(0);
  });

  it("leaves draft sections untouched and attaches a proposal for statutory caps", () => {
    const draft: ArtifactDraft = {
      taskId: "t-sr",
      title: "买卖合同",
      summary: "定金条款",
      sections: [
        { heading: "定金", body: "定金为本合同标的额的 30%，双方盖章签署。", citations: [] },
      ],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    const out = applySelfReviseToDraft(draft);
    expect(draft.sections[0]?.body).toContain("30%");
    expect(draft.sections[0]?.body).not.toContain("20%");
    expect(out.applied.some((a) => a.ruleId === "statutory.deposit_cap")).toBe(false);
    const proposal = out.proposals.find((p) => p.ruleId === "statutory.deposit_cap");
    expect(proposal?.requiresLawyerDecision).toBe(true);
    expect(proposal?.after).toContain("20%");
  });

  it("does not rewrite the draft title", () => {
    const draft: ArtifactDraft = {
      taskId: "t-sr-title",
      title: "审查定金30%条款",
      summary: "定金条款审查",
      sections: [
        { heading: "定金", body: "定金为本合同标的额的 30%，双方盖章签署。", citations: [] },
      ],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    applySelfReviseToDraft(draft);
    expect(draft.title).toBe("审查定金30%条款");
    expect(draft.sections[0]?.body).toContain("30%");
  });

  it("records a self_revise provenance event when a section body is normalized", () => {
    const draft: ArtifactDraft = {
      taskId: "t-sr-prov",
      title: "定金条款",
      summary: "条款",
      sections: [{ heading: "正文", body: "第一条\u3000双方按约履行。", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    applySelfReviseToDraft(draft);
    expect(draft.sections[0]?.body).not.toContain("\u3000");
    const events = draft.sections[0]?.provenance?.events ?? [];
    expect(events.some((e) => e.type === "self_revise")).toBe(true);
    expect(events.find((e) => e.type === "self_revise")?.reason).toContain(
      "normalize.fullwidth_space",
    );
  });

  it("keeps family findings in residual when deliverableType is passed", () => {
    const text = "房屋租赁合同。第一条 甲乙双方订立本合同。双方按约履行条款。";
    const bare = previewSelfRevise(text);
    expect(bare.residual.some((f) => f.ruleId === "lease.rent")).toBe(false);
    const typed = previewSelfRevise(text, { deliverableType: "contract.review" });
    expect(typed.residual.some((f) => f.ruleId === "lease.rent")).toBe(true);
  });
});
