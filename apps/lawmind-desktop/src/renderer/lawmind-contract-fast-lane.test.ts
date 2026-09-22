import { describe, expect, it } from "vitest";
import {
  buildContractFastLanePrompt,
  depthInstruction,
  stanceIntakeValue,
  type ContractReviewDepth,
  type ContractReviewStance,
} from "./lawmind-contract-fast-lane";

describe("lawmind-contract-fast-lane", () => {
  it("maps stance chips to lawyer-facing intake values", () => {
    expect(stanceIntakeValue("neutral")).toBe("中立");
    expect(stanceIntakeValue("client")).toContain("委托方");
    expect(stanceIntakeValue("counterparty")).toContain("相对方");
  });

  it("builds a structured contract.review handoff with depth", () => {
    const prompt = buildContractFastLanePrompt({
      materials: "cases/demo/合同.docx",
      focus: "付款与违约",
      stance: "client",
      depth: "quick",
    });
    expect(prompt).toContain("【交办】");
    expect(prompt).toContain("交付物类型：合同审查意见");
    expect(prompt).toContain("委托方");
    expect(prompt).toContain("审查深度：快速");
    expect(prompt).toContain("付款与违约");
  });

  it("depth instructions differ", () => {
    expect(depthInstruction("quick")).toContain("快速");
    expect(depthInstruction("standard")).toContain("标准");
    expect(depthInstruction("deep")).toContain("深度");
  });

  const stances: ContractReviewStance[] = ["neutral", "client", "counterparty"];
  const depths: ContractReviewDepth[] = ["quick", "standard", "deep"];

  it.each(stances.flatMap((stance) => depths.map((depth) => ({ stance, depth }))))(
    "locks structure lines for $stance × $depth",
    ({ stance, depth }) => {
      const prompt = buildContractFastLanePrompt({
        materials: "nda.docx",
        stance,
        depth,
      });
      expect(prompt).toContain("交付物类型：合同审查意见");
      expect(prompt).toContain("审查深度：");
      if (stance === "neutral") {
        expect(prompt).toContain("中立");
      } else if (stance === "client") {
        expect(prompt).toContain("委托方");
      } else {
        expect(prompt).toContain("相对方");
      }
    },
  );

  it("inserts adopted prefs only when provided", () => {
    const withPrefs = buildContractFastLanePrompt({
      materials: "nda.docx",
      stance: "neutral",
      depth: "standard",
      lawyerPrefs: "管辖优先选上海",
    });
    expect(withPrefs).toContain("【已采纳偏好】");
    expect(withPrefs).toContain("管辖优先选上海");
    const without = buildContractFastLanePrompt({
      materials: "nda.docx",
      stance: "neutral",
      depth: "standard",
    });
    expect(without).not.toContain("【已采纳偏好】");
  });
});
