import { describe, expect, it } from "vitest";
import { runLegalLint } from "../lint/run-lint.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  loadShadowFixtures,
  runShadowReplay,
  textOverlapRatio,
} from "./shadow-replay.js";

describe("shadow-replay", () => {
  it("ships synthetic fixtures including deposit 30%, or-arbitrate, clean, and family packs", () => {
    const fromDisk = loadShadowFixtures();
    expect(fromDisk.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_SHADOW_FIXTURES.length).toBeGreaterThanOrEqual(10);
    expect(BUILTIN_SHADOW_FIXTURES.map((f) => f.id)).toEqual(
      expect.arrayContaining(["shadow-clean-nda", "shadow-deposit-30", "shadow-or-arbitrate"]),
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

  it("static layer: deterministic lint-regression on fixture strings (not replay evidence)", () => {
    const first = runShadowReplay(BUILTIN_SHADOW_FIXTURES);
    const second = runShadowReplay(BUILTIN_SHADOW_FIXTURES);
    expect(first.summary.cases).toBe(BUILTIN_SHADOW_FIXTURES.length);
    expect(first.summary.meanOverlap).toBeGreaterThan(0);
    // 静态层语义 = lint 回归：recall=1 只声明「植入规则仍命中静态串」，
    // 草稿不经引擎；真回放证据在 engine-scripted-model 层（shadow-engine-replay.test.ts），
    // 其召回由引擎真实产出计算、允许 <1。
    expect(first.summary.defectRecall).toBe(1);
    // 口径标注：草稿来源必须是 fixture 静态串，不得冒充引擎产出
    expect(first.summary.draftSource).toBe("fixture-static");
    expect(first.summary.reportZh).toContain("影子回放");
    expect(first.summary.reportZh).toContain("植入缺陷召回");
    expect(first.summary.reportZh).toContain("非引擎产出");
    expect(second).toEqual(first);

    const deposit = first.results.find((r) => r.id === "shadow-deposit-30");
    const arb = first.results.find((r) => r.id === "shadow-or-arbitrate");
    const clean = first.results.find((r) => r.id === "shadow-clean-nda");
    expect(deposit?.plantedDefectRecall).toBe(1);
    expect(deposit?.hitRuleIds).toContain("statutory.deposit_cap");
    expect(arb?.plantedDefectRecall).toBe(1);
    expect(arb?.hitRuleIds).toContain("form.or_arbitrate_or_sue");
    const lease = first.results.find((r) => r.id === "shadow-lease-no-rent");
    expect(lease?.plantedDefectRecall).toBe(1);
    expect(lease?.hitRuleIds).toContain("lease.rent");
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
