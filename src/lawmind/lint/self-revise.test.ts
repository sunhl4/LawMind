import { describe, expect, it } from "vitest";
import { runLegalLint } from "./run-lint.js";
import { previewSelfRevise, runSelfRevise } from "./self-revise.js";

describe("runSelfRevise", () => {
  it("rewrites deposit over the cap to 20% and clears the deposit blocker", () => {
    const text = "第一条 定金为本合同标的额的 30%。双方按约履行。";
    const first = runLegalLint(text);
    expect(first.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
    expect(first.findings.find((f) => f.ruleId === "statutory.deposit_cap")?.severity).toBe(
      "blocker",
    );

    const revised = runSelfRevise(text, first);
    expect(revised.applied.some((a) => a.ruleId === "statutory.deposit_cap")).toBe(true);
    expect(revised.text).toContain("20%");
    expect(revised.text).not.toContain("30%");
    expect(revised.summaryZh).toMatch(/已自检 \d+ 轮/);

    const second = runLegalLint(revised.text);
    expect(second.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(false);
    expect(revised.residual.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(false);
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
});
