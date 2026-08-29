import { describe, expect, it } from "vitest";
import { runLegalLint } from "../lint/run-lint.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  loadShadowFixtures,
  runShadowReplay,
  textOverlapRatio,
} from "./shadow-replay.js";

describe("shadow-replay", () => {
  it("ships three synthetic fixtures including deposit 30%, or-arbitrate, and clean", () => {
    const fromDisk = loadShadowFixtures();
    expect(fromDisk.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_SHADOW_FIXTURES.map((f) => f.id).toSorted()).toEqual(
      ["shadow-clean-nda", "shadow-deposit-30", "shadow-or-arbitrate"].toSorted(),
    );
    expect(
      fromDisk.some(
        (f) =>
          f.id === "shadow-deposit-30" && f.plantedDefectRuleIds?.includes("statutory.deposit_cap"),
      ),
    ).toBe(true);
    expect(
      fromDisk.some(
        (f) =>
          f.id === "shadow-or-arbitrate" &&
          f.plantedDefectRuleIds?.includes("form.or_arbitrate_or_sue"),
      ),
    ).toBe(true);
    expect(
      fromDisk.some((f) => f.id === "shadow-clean-nda" && !f.plantedDefectRuleIds?.length),
    ).toBe(true);
  });

  it("computes deterministic overlap and planted-defect recall without engine.plan/draft", () => {
    const first = runShadowReplay(BUILTIN_SHADOW_FIXTURES);
    const second = runShadowReplay(BUILTIN_SHADOW_FIXTURES);
    expect(first.summary.cases).toBe(3);
    expect(first.summary.meanOverlap).toBeGreaterThan(0);
    expect(first.summary.defectRecall).toBe(1);
    expect(first.summary.reportZh).toContain("影子回放");
    expect(first.summary.reportZh).toContain("植入缺陷召回");
    expect(second).toEqual(first);

    const deposit = first.results.find((r) => r.id === "shadow-deposit-30");
    const arb = first.results.find((r) => r.id === "shadow-or-arbitrate");
    const clean = first.results.find((r) => r.id === "shadow-clean-nda");
    expect(deposit?.plantedDefectRecall).toBe(1);
    expect(deposit?.hitRuleIds).toContain("statutory.deposit_cap");
    expect(arb?.plantedDefectRecall).toBe(1);
    expect(arb?.hitRuleIds).toContain("form.or_arbitrate_or_sue");
    expect(clean?.plantedDefectRecall).toBeNull();
    expect(clean?.similarity).toBe(1);
  });

  it("keeps overlap deterministic and lint recall tied to engineDraftText", () => {
    expect(textOverlapRatio("定金百分之十", "定金百分之十")).toBe(1);
    expect(textOverlapRatio("", "有正文")).toBe(0);
    const lint = runLegalLint("第一条 定金为本合同标的额的 30%。");
    expect(lint.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
  });

  it("leaves defectRecall null when no planted ids exist", () => {
    const report = runShadowReplay([
      {
        id: "only-clean",
        instruction: "起草保密条款",
        lawyerFinalText: "保密三年",
        engineDraftText: "保密三年",
      },
    ]);
    expect(report.summary.defectRecall).toBeNull();
    expect(report.summary.reportZh).toContain("无植入样本");
  });
});
