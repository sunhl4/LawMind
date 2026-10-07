import { describe, expect, it } from "vitest";
import {
  charFBeta,
  cuadDateAnswer,
  exactAccuracy,
  multiLabelF1,
  normalizedLogDistance,
  rcF1,
  rougeL,
  singleLabelAccuracy,
  softF1,
} from "./legal-bench-metrics.js";

describe("official metric definitions", () => {
  it("scores exact accuracy and rejects a single-label answer that extracted two labels", () => {
    expect(exactAccuracy("故意伤害", "故意伤害")).toBe(1);
    expect(exactAccuracy(" 故意伤害 ", "故意伤害")).toBe(1);
    expect(exactAccuracy("过失致人死亡", "故意伤害")).toBe(0);
    expect(singleLabelAccuracy(["故意伤害"], "故意伤害")).toBe(1);
    expect(singleLabelAccuracy(["故意伤害", "过失致人死亡"], "故意伤害")).toBe(0);
    expect(singleLabelAccuracy([], "故意伤害")).toBe(0);
  });

  it("computes multi-label F1 as the harmonic mean of set precision and recall", () => {
    expect(multiLabelF1(["抚养权", "探望权"], ["抚养权", "探望权"])).toBe(1);
    expect(multiLabelF1(["抚养权", "离婚"], ["抚养权", "探望权"])).toBeCloseTo(0.5, 5);
    expect(multiLabelF1([], ["抚养权"])).toBe(0);
    expect(multiLabelF1([], [])).toBe(1);
  });

  it("computes character rc-F1 and proofreading F0.5", () => {
    expect(rcF1("经济补偿按工作年限支付", "经济补偿按工作年限支付")).toBe(1);
    expect(rcF1("经济补偿", "经济补偿按工作年限支付")).toBeGreaterThan(0);
    expect(rcF1("经济补偿", "经济补偿按工作年限支付")).toBeLessThan(1);
    const tight = charFBeta("经济补偿按工作年限支付", "经济补偿按工作年限支付", 0.5);
    const loose = charFBeta("无关文字经济补偿按工作年限支付", "经济补偿按工作年限支付", 0.5);
    expect(tight).toBe(1);
    expect(loose).toBeLessThan(tight);
  });

  it("uses rc-F1 inside soft-F1 so a near phrase still counts", () => {
    expect(softF1(["上海示例科技有限公司"], ["上海示例科技有限公司"])).toBe(1);
    expect(softF1(["上海示例科技"], ["上海示例科技有限公司"])).toBeGreaterThan(0.5);
    expect(softF1(["完全不同的名称"], ["上海示例科技有限公司"])).toBeLessThan(0.5);
  });

  it("scores ROUGE-L by character LCS and keeps overlap when a judgment is appended", () => {
    const gold = "经济补偿按劳动者在本单位工作的年限支付。";
    expect(rougeL(gold, gold)).toBe(1);
    const withJudgment = `${gold}我方主张两种路径都写入意见。`;
    const score = rougeL(withJudgment, gold);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
    expect(rougeL("无关", gold)).toBeLessThan(score);
  });

  it("scores normalized log-distance at 1 for an exact term and lower for a farther term", () => {
    expect(normalizedLogDistance(36, 36)).toBe(1);
    const near = normalizedLogDistance(24, 36);
    const far = normalizedLogDistance(6, 36);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(normalizedLogDistance(Number.NaN, 36)).toBe(0);
  });

  it("normalizes a Chinese contract date to the CUAD mm/dd/yyyy answer", () => {
    expect(cuadDateAnswer("本合同于2024年3月1日签署。")).toBe("03/01/2024");
    expect(cuadDateAnswer("2024-03-01")).toBe("03/01/2024");
    expect(cuadDateAnswer("签署地点为上海")).toBeUndefined();
  });
});
