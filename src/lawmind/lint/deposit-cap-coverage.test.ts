/**
 * 实测出的规则盲区 —— 精确复现（2026-09-21，由一轮真实办件发现）。
 *
 * 背景：`scripts/lawmind/lawmind-round.ts` 跑一笔真实设备采购合同审查时发现，
 * 合同**最严重的实体缺陷**——定金 310,000 元 / 标的额 1,032,000 元 = **30.04%**，
 * 超《民法典》第 586 条的 20% 上限——被 `statutory.deposit_cap` **静默放过**。
 *
 * 本文件**不是**在断言「这是对的行为」，而是在：
 *   1. 把这条盲区钉成可复现的证据（不是叙述）；
 *   2. 让「将来修好了」与「将来改坏了」都能被立刻发现。
 *
 * ## 修法须走规则验收流程，不在本次范围
 *
 * 修它需要判定「哪一个是标的额」（可能是合同总额、也可能是某一分项），
 * 属于需要执业法律顾问复核的判据设计——按
 * [LAWMIND-LEGAL-COMPILER-ROADMAP.md](../LAWMIND-LEGAL-COMPILER-ROADMAP.md) §1.5 的铁律：
 * **没有法律顾问验收的规则不得从 advisory 升 blocking**；而这里涉及的是**已有 blocker 的判据扩张**，
 * 只会更严。所以本次只做归因与固化，并把它作为规则候选交给飞轮
 * （`escape-candidates.jsonl` 会带 `ruleIds` 与触发原文）。
 */

import { describe, expect, it } from "vitest";
import { findDepositPercents } from "./rules.js";
import { runLegalLint } from "./run-lint.js";
import { DEPOSIT_CAP } from "./statute-params.js";

/** 直接跑单条规则，避免其他规则干扰判定。 */
function depositCapFires(text: string, deliverableType = "contract.review"): boolean {
  return runLegalLint(text, undefined, undefined, undefined, { deliverableType }).findings.some(
    (f) => f.ruleId === "statutory.deposit_cap",
  );
}

describe("statutory.deposit_cap 的已知盲区：只认显式百分比，不从金额反算比例", () => {
  it("显式百分比 → 命中（规则按设计工作）", () => {
    expect(depositCapFires("第二条 定金：甲方应支付定金 30% 即 310,000 元。")).toBe(true);
    expect(depositCapFires("定金不得低于百分之四十（40%）。")).toBe(true);
  });

  it("**盲区**：只写绝对金额、从不写百分比 → 静默放过（哪怕实际超上限）", () => {
    // 真实合同的常见写法：给金额、给标的额，但从不写「30%」
    const contractLikeText = [
      "第一条 标的与价款",
      "1.1 乙方向甲方供应精密检测设备 12 台，合同总价款为 1032000 元。",
      "",
      "第二条 定金",
      "2.1 甲方应于本合同签订之日起 5 个工作日内向乙方支付定金 310,000 元。",
      "2.2 乙方按约交货后，定金抵作价款。",
    ].join("\n");

    // 实际比例确实超上限——这是与规则无关的算术事实
    const actualPct = (310_000 / 1_032_000) * 100;
    expect(actualPct).toBeGreaterThan(DEPOSIT_CAP.value * 100);
    expect(actualPct).toBeCloseTo(30.04, 1);

    // 但规则不命中
    expect(findDepositPercents(contractLikeText)).toEqual([]);
    expect(depositCapFires(contractLikeText)).toBe(false);
  });

  it("命中条件的确切形状：必须「定金」与百分比在同句内、且相隔 ≤24 字", () => {
    // 命中
    expect(findDepositPercents("定金 30%")).toHaveLength(1);
    // 有「定金」也有百分比，但百分比离得太远 → 不命中
    expect(findDepositPercents(`定金${"啊".repeat(30)}30%`)).toEqual([]);
    // 跨句号 → 不命中
    expect(findDepositPercents("定金。30%")).toEqual([]);
    // 没有「定金」二字 → 完全不看
    expect(findDepositPercents("预付款 30%")).toEqual([]);
  });

  it("门槛值来自参数库（可追溯），不是硬编码在规则里", () => {
    expect(DEPOSIT_CAP.value).toBe(0.2);
    expect(DEPOSIT_CAP.source).toBe("民法典第586条");
    expect(DEPOSIT_CAP.effectiveFrom).toBe("2021-01-01");
  });

  it("边界：恰好等于上限不报，超过才报", () => {
    expect(depositCapFires("定金 20%")).toBe(false);
    expect(depositCapFires("定金 20.1%")).toBe(true);
  });
});
