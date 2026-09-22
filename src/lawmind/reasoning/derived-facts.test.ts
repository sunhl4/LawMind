/**
 * 派生事实（第二类：该算的算好，作为素材喂给模型）。
 *
 * 两条最重要的断言：
 *   1. **能算出规则漏掉的**——真实合同只写金额（310,000 元）、从不写百分比，
 *      `statutory.deposit_cap` 静默放过，而本模块能算出来；
 *   2. **算不出来就什么都不说**——找不到明确的标的额时不猜。
 *
 * 另有一条「不是结论」的口径检查：产出里不得出现法律结论词。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runLegalLint } from "../lint/run-lint.js";
import { DEFAULT_LIMITATION } from "../lint/statute-params.js";
import {
  addPeriod,
  collectDerivedFacts,
  computeDeliverableScopeFact,
  computeDepositCapFact,
  computePaymentRatioSumFact,
  computePaymentSumFact,
  computePenaltyAsymmetryFact,
  computeDeadlineFact,
  computeLimitationDeadlineFact,
  computeTotalConsistencyFact,
  computeUnitPriceFact,
  describeDerivedFacts,
  findMoneyAmounts,
  findPaymentItems,
  formatDerivedFactsPromptBlock,
  loadDerivedFactsForMatter,
} from "./derived-facts.js";

/** 与 `fixtures/lawmind-round/purchase-contract.md` 同形的关键段落。 */
const CONTRACT_LIKE = [
  "第一条 标的与价款",
  "1.1 乙方向甲方供应精密检测设备 12 台，型号 LX-880，单价 86,000 元，合同总价款为 1032000 元。",
  "",
  "第二条 定金",
  "2.1 甲方应于本合同签订之日起 5 个工作日内向乙方支付定金 310,000 元。",
  "2.2 乙方按约交货后，定金抵作价款。",
  "",
  "第四条 付款",
  "4.2 全部设备验收合格后支付 722,400 元。",
].join("\n");

describe("金额解析", () => {
  it("识别元与万元，统一折算成元", () => {
    expect(findMoneyAmounts("合同总价款 1032000 元")[0]?.value).toBe(1_032_000);
    expect(findMoneyAmounts("价款 103.2 万元")[0]?.value).toBe(1_032_000);
    expect(findMoneyAmounts("定金 310,000 元")[0]?.value).toBe(310_000);
  });

  it("无单位的纯数字不被当作金额（避免把日期/条号当钱）", () => {
    expect(findMoneyAmounts("于 2026 年 11 月 30 日前交付 12 台")).toEqual([]);
  });

  it("保留原文片段供律师核对", () => {
    expect(findMoneyAmounts("合同总价款为 1032000 元")[0]?.span).toBe("1032000 元");
  });
});

describe("定金上限事实：**能算出规则漏掉的**", () => {
  it("**核心用例**：只说金额、不说百分比 → 规则静默放过，本模块算得出来", () => {
    // 规则侧：确认它确实漏了（这是本模块存在的全部理由）
    const lintFindings = runLegalLint(CONTRACT_LIKE, undefined, undefined, undefined, {
      deliverableType: "contract.review",
    }).findings.filter((f) => f.ruleId === "statutory.deposit_cap");
    expect(lintFindings).toEqual([]);

    // 本模块侧：算出来
    const fact = computeDepositCapFact(CONTRACT_LIKE);
    expect(fact).toBeDefined();
    expect(fact?.kind).toBe("deposit_cap_ratio");
    // 真实占比 30.04%（310000 / 1032000）
    expect(fact?.statement).toContain("30.04%");
    expect(fact?.statement).toContain("20%");
    expect(fact?.statement).toContain("103,600"); // 超出金额
  });

  it("算式自洽且可复核（比值精度足够，不与百分数矛盾）", () => {
    const fact = computeDepositCapFact(CONTRACT_LIKE)!;
    // 这条曾经是 bug：ratio 用 round2 会把 0.3004 显示成 0.3，与「→ 30.04%」自相矛盾
    expect(fact.arithmetic).toContain("0.3004");
    expect(fact.arithmetic).not.toMatch(/=\s*0\.3\s*→/);
    // 三行算式：占比 / 上限 / 超出
    expect(fact.arithmetic.split("\n")).toHaveLength(3);
    expect(fact.arithmetic).toContain("1032000 × 20% = 206400");
    expect(fact.arithmetic).toContain("310000 − 206400 = 103600");
  });

  it("出处可追溯（法条 + 原料片段），不写「依据相关规定」", () => {
    const fact = computeDepositCapFact(CONTRACT_LIKE)!;
    expect(fact.citations).toEqual(["民法典第586条"]);
    expect(fact.provenance.map((p) => p.label)).toEqual(["合同标的额", "定金"]);
    expect(fact.provenance.map((p) => p.span)).toEqual(["1032000 元", "310,000 元"]);
  });

  it("未超上限也产出（同样是有用的事实：模型不必自己算）", () => {
    const text = "合同总价款为 1000000 元。甲方支付定金 100,000 元。";
    const fact = computeDepositCapFact(text);
    expect(fact).toBeDefined();
    expect(fact?.statement).toContain("未超上限");
    expect(fact?.statement).toContain("10%");
  });

  it("恰好等于上限 → 判为未超（边界包含）", () => {
    const fact = computeDepositCapFact("合同总价款为 1000000 元。甲方支付定金 200,000 元。");
    expect(fact?.statement).toContain("未超上限");
  });

  it("略超上限 → 判为超出", () => {
    const fact = computeDepositCapFact("合同总价款为 1000000 元。甲方支付定金 200,100 元。");
    expect(fact?.statement).toContain("高出");
  });

  it("万元写法同样能算", () => {
    const fact = computeDepositCapFact("合同总价款为 103.2 万元。甲方支付定金 31 万元。");
    expect(fact).toBeDefined();
    expect(fact?.statement).toContain("30.04%");
  });
});

describe("定金上限事实：**算不出来就什么都不说**", () => {
  it("找不到标的额标记 → 不产出（不猜）", () => {
    // 有定金、有金额，但没有「合同总价款/标的额」这类明确标记
    expect(computeDepositCapFact("甲方支付定金 310,000 元。乙方交付设备。")).toBeUndefined();
  });

  it("有标的额但没有定金 → 不产出", () => {
    expect(computeDepositCapFact("合同总价款为 1032000 元。乙方交付设备。")).toBeUndefined();
  });

  it("文本里没有「定金」二字 → 完全不看", () => {
    expect(
      computeDepositCapFact("合同总价款为 1032000 元。甲方支付预付款 310,000 元。"),
    ).toBeUndefined();
  });

  it("**标题里的「定金」不会劫持计算**（实测抓到的 bug）", () => {
    // 「## 第二条 定金」这种标题会先命中标记，但标题后没有金额。
    // 若只看标记的第一次出现，就会放弃整个计算、真实的那条规定反而读不到。
    const text = ["第二条 定金", "2.1 甲方支付定金 310,000 元，合同总价款为 1032000 元。"].join(
      "\n",
    );
    const fact = computeDepositCapFact(text);
    expect(fact).toBeDefined();
    expect(fact?.provenance.find((p) => p.label === "定金")?.span).toBe("310,000 元");
  });
});

describe("口径：是事实，不是结论", () => {
  const fact = computeDepositCapFact(CONTRACT_LIKE)!;

  it("产出里**不得出现**法律结论词", () => {
    const blob = `${fact.statement}\n${fact.arithmetic}\n${fact.citations.join(" ")}`;
    for (const word of ["违反", "无效", "必须", "应当修改", "不产生定金效力", "违法"]) {
      expect(blob).not.toContain(word);
    }
  });

  it("但必须说清是「谁规定的上限」（可追溯）", () => {
    expect(fact.statement).toContain("民法典第586条");
    expect(fact.statement).toContain("上限");
  });
});

describe("collectDerivedFacts", () => {
  it("短文本直接空返回（不浪费）", () => {
    expect(collectDerivedFacts("定金 1 元")).toEqual([]);
  });

  it("永不为抛（畸形输入）", () => {
    for (const bad of ["", "   ", "定金".repeat(1000)]) {
      expect(() => collectDerivedFacts(bad)).not.toThrow();
    }
  });

  it("limit 生效", () => {
    expect(collectDerivedFacts(CONTRACT_LIKE, { limit: 0 })).toEqual([]);
  });

  it("describeDerivedFacts 对空结果诚实（不是「没问题」）", () => {
    expect(describeDerivedFacts([])).toContain("不是「没有问题」");
  });
});

describe("注入文案：素材，不是指令", () => {
  const block = formatDerivedFactsPromptBlock(collectDerivedFacts(CONTRACT_LIKE))!;

  it("空输入 → undefined（不注入空标题）", () => {
    expect(formatDerivedFactsPromptBlock([])).toBeUndefined();
  });

  it("明说是代码算的、可复核、且是事实非结论", () => {
    expect(block).toContain("代码计算");
    expect(block).toContain("可自行复核");
    expect(block).toContain("**事实**而非结论");
  });

  it("**不得出现命令式**（与改稿范例同一纪律）", () => {
    expect(block).not.toContain("必须");
    expect(block).not.toContain("一律");
    expect(block).not.toContain("禁止");
    expect(block).not.toContain("不得");
  });

  it("算式与出处都随块给出（可复核性）", () => {
    expect(block).toContain("可自行复核");
    expect(block).toContain("0.3004");
    expect(block).toContain("民法典第586条");
    // 紧凑格式：算式与出处合并在括号行
    expect(block).toMatch(/^\s*（.*0\.3004.*民法典第586条）$/m);
  });

  it("块长受上限约束，且**整条取舍**而不是腰斩（实测抓到的截断问题）", () => {
    const facts = collectDerivedFacts(CONTRACT_LIKE);
    const capped = formatDerivedFactsPromptBlock(facts, { maxChars: 260 })!;
    // 至少保留第一条，且不出现被切一半的事实（每条都以「）」收尾）
    const bulletLines = capped.split("\n").filter((l) => l.startsWith("- "));
    expect(bulletLines.length).toBeGreaterThanOrEqual(1);
    const detailLines = capped.split("\n").filter((l) => l.trim().startsWith("（"));
    for (const l of detailLines) {
      expect(l.trim().endsWith("）")).toBe(true);
    }
    // 丢掉的部分要说明还有几条
    expect(capped).toMatch(/另有 \d+ 条算好的事实未展开/);
  });
});

// ─────────────────────────────────────────────
// 第二类 · 扩展：体裁 / 付款合计 / 违约金结构
// ─────────────────────────────────────────────

describe("体裁事实：解「合同类规则用在信函上」的困惑", () => {
  it("信函 → 明确说是函件，并给出发函语境下的主体称谓惯例", () => {
    const fact = computeDeliverableScopeFact("x", { deliverableType: "letter.demand" });
    expect(fact?.kind).toBe("deliverable_scope");
    expect(fact?.statement).toContain("函件");
    expect(fact?.statement).toContain("只需指明收件人");
    expect(fact?.statement).not.toContain("letter.demand**");
  });

  it("合同文本类 → 保留成对出现的常规要求（不因统一口径而丢失）", () => {
    const fact = computeDeliverableScopeFact("x", { deliverableType: "contract.general" });
    expect(fact?.statement).toContain("合同文本");
    expect(fact?.statement).toContain("成对出现");
  });

  it("**精确匹配优先**：contract.review 是意见书，不是合同文本（实测它正是踩误报的那个）", () => {
    const fact = computeDeliverableScopeFact("x", { deliverableType: "contract.review" });
    expect(fact?.statement).toContain("合同审查意见书");
    expect(fact?.statement).toContain("不是合同文本本身");
    expect(fact?.statement).toContain("不构成合同主体成对性要求");
    // 不得把它按前缀归成「合同文本」（那会给出相反提示）
    expect(fact?.statement).not.toContain("属**合同文本**");
  });

  it("备忘录 / 诉讼文书各有自己的体裁说明", () => {
    expect(
      computeDeliverableScopeFact("x", { deliverableType: "memo.opinion" })?.statement,
    ).toContain("备忘录");
    expect(
      computeDeliverableScopeFact("x", { deliverableType: "litigation.complaint" })?.statement,
    ).toContain("诉讼文书");
  });

  it("未收录的类型 → 不产出（不硬编一个体裁）", () => {
    expect(computeDeliverableScopeFact("x", { deliverableType: "review.table" })).toBeUndefined();
  });

  it("无交付物类型 → 不产出", () => {
    expect(computeDeliverableScopeFact("x", {})).toBeUndefined();
  });

  it("短文本也能产出体裁事实（它只依赖类型，不依赖正文）", () => {
    const facts = collectDerivedFacts("短", { deliverableType: "letter.demand" });
    expect(facts.map((f) => f.kind)).toEqual(["deliverable_scope"]);
  });

  it("体裁事实不下法律结论、不是命令", () => {
    const fact = computeDeliverableScopeFact("x", { deliverableType: "letter.demand" })!;
    const blob = `${fact.statement}\n${fact.arithmetic}`;
    for (const w of ["必须", "一律", "禁止", "不得", "违反", "无效"]) {
      expect(blob).not.toContain(w);
    }
  });
});

describe("付款分项合计：会算出「付的钱比总价还多」这类硬矛盾", () => {
  const CONTRACT_WITH_MISMATCH = [
    "第一条 标的与价款",
    "1.1 合同总价款为 1032000 元。",
    "",
    "第二条 定金",
    "2.1 甲方应于本合同签订之日起 5 个工作日内向乙方支付定金 310,000 元。",
    "",
    "第四条 付款",
    "4.1 合同签订后支付定金 310,000 元（已含于总价款内）。",
    "4.2 全部设备验收合格后支付 722,400 元。",
  ].join("\n");

  it("**核心用例**：分项合计超出总价 → 算出差额", () => {
    const fact = computePaymentSumFact(CONTRACT_WITH_MISMATCH);
    expect(fact?.kind).toBe("payment_sum");
    expect(fact?.statement).toContain("1,032,400");
    expect(fact?.statement).toContain("多 400");
    // 算式两行：求和 + 差额（这是「可复核」的具体形态）
    expect(fact?.arithmetic.split("\n")).toEqual([
      "310000 + 722400 = 1032400",
      "1032400 − 1032000 = 400",
    ]);
  });

  it("同一笔钱写两处（定金在第二条与第四条）→ **去重**，不重复计", () => {
    const items = findPaymentItems(CONTRACT_WITH_MISMATCH);
    const depositItems = items.filter((i) => i.label === "定金");
    expect(depositItems).toHaveLength(2); // 原文确实出现两次
    // 但合计只算一次
    const fact = computePaymentSumFact(CONTRACT_WITH_MISMATCH)!;
    expect(fact.arithmetic.split("\n")[0]).toBe("310000 + 722400 = 1032400");
  });

  it("**标签不跨句**：上一条款尾部的词不会被算到本条金额上（实测 bug）", () => {
    // 4.1 结尾「已含于总价款内」落在 4.2 金额的前 24 字窗口内；
    // 若不按句切开，722,400 会被错误贴上「价款」这个并不存在的名目。
    const items = findPaymentItems(CONTRACT_WITH_MISMATCH);
    const second = items.find((i) => i.value === 722_400);
    expect(second?.label).toBe("");
  });

  it("合计与总价一致 → 产出「一致」事实（同样有用）", () => {
    const text = [
      "合同总价款为 1000000 元。",
      "1 支付首付款 300,000 元。",
      "2 支付尾款 700,000 元。",
    ].join("\n");
    const fact = computePaymentSumFact(text);
    expect(fact?.statement).toContain("与总价一致");
  });

  it("以百分比表述的分项被排除，且产出里**明确说明**（不让模型以为合计已完整）", () => {
    const fact = computePaymentSumFact(CONTRACT_WITH_MISMATCH)!;
    expect(fact.statement).toContain("以百分比表述的分项未计入");
  });

  it("少于两个分项 → 不产出（单项构不成合计矛盾）", () => {
    expect(computePaymentSumFact("合同总价款为 1000000 元。支付定金 300,000 元。")).toBeUndefined();
  });

  it("无标的额标记 → 不产出", () => {
    expect(computePaymentSumFact("支付首付款 300,000 元。支付尾款 700,000 元。")).toBeUndefined();
  });

  it("裸金额不算付款分项（总价/单价带「支付」才可能被误收）", () => {
    const items = findPaymentItems("合同总价款为 1032000 元。单价 86,000 元。");
    expect(items).toEqual([]);
  });
});

describe("逾期违约金结构：陈述可比性，不判「不公平」", () => {
  const ASYM = [
    "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
    "5.2 甲方逾期付款的，每逾期一日按逾期金额的 0.05% 向乙方支付违约金。",
  ].join("\n");

  it("**基数不同 → 明确说不可比**（不硬算倍数当结论）", () => {
    const fact = computePenaltyAsymmetryFact(ASYM);
    expect(fact?.kind).toBe("penalty_asymmetry");
    expect(fact?.statement).toContain("5%/日");
    expect(fact?.statement).toContain("0.05%/日");
    expect(fact?.statement).toContain("基数不同");
    expect(fact?.statement).toContain("不可直接比较");
    // **关键**：不得把它说成「相差 100 倍不利」——基数不同，倍数没有意义
    expect(fact?.statement).not.toContain("100 倍");
  });

  it("两侧基数相同 → 才给出倍数，并说明可比较", () => {
    const same = [
      "甲方逾期付款按合同总价款的 0.05%/日承担违约金。",
      "乙方逾期交货按合同总价款的 5%/日承担违约金。",
    ].join("\n");
    const fact = computePenaltyAsymmetryFact(same);
    expect(fact?.statement).toContain("基数相同");
    expect(fact?.arithmetic).toContain("100");
  });

  it("少于两条逾期条款 → 不产出", () => {
    expect(computePenaltyAsymmetryFact("乙方逾期交货按合同总价款的 5%/日。")).toBeUndefined();
  });

  it("不下法律结论", () => {
    const fact = computePenaltyAsymmetryFact(ASYM)!;
    for (const w of ["不公平", "显失公平", "无效", "必须", "应当修改"]) {
      expect(fact.statement).not.toContain(w);
    }
  });

  it("出处保留原文片段，便于律师回原文核对", () => {
    const fact = computePenaltyAsymmetryFact(ASYM)!;
    expect(fact.provenance).toHaveLength(2);
    expect(fact.provenance[0]?.span).toContain("乙方");
  });
});

describe("单价 × 数量 vs 总价（纯算术，会算出硬错误）", () => {
  it("一致 → 产出「一致」事实（模型不必自己乘）", () => {
    const fact = computeUnitPriceFact(
      "1.1 供应精密检测设备 12 台，型号 LX-880，单价 86,000 元，合同总价款为 1032000 元。",
    );
    expect(fact?.kind).toBe("unit_price_times_quantity");
    expect(fact?.statement).toContain("86,000 元 × 12 台");
    expect(fact?.statement).toContain("1,032,000");
    expect(fact?.statement).toContain("与合同标的额一致");
    expect(fact?.arithmetic).toBe("86000 × 12 = 1032000");
  });

  it("**不一致 → 算出差额**（这是真正的算术错误，不是判断）", () => {
    const fact = computeUnitPriceFact(
      "1.1 供应设备 12 台，单价 86,000 元，合同总价款为 1000000 元。",
    );
    expect(fact?.statement).toContain("相差 32,000");
    expect(fact?.arithmetic).toContain("1032000 − 1000000 = 32000");
  });

  it("**名目可空**：没有付款名目的比例也是付款比例（实测：强制要求名目会漏）", () => {
    const fact = computePaymentRatioSumFact(
      "1 支付首付款 30%。\n2 验收合格后支付 65%。\n3 余款 5% 于质保期届满后退还。",
    );
    // 30 + 65 + 5 = 100 —— 中间那条没有名目，也必须计入
    expect(fact?.arithmetic.split("\n")[0]).toBe("30 + 65 + 5 = 100");
    expect(fact?.statement).not.toContain("  +  "); // 空名目不留双空格
  });

  it("**容差不计**：「误差不超过 1%」不是付款比例", () => {
    expect(computePaymentRatioSumFact("精度误差不超过 1%。噪声偏差低于 2%。")).toBeUndefined();
  });

  it("数量可以写在单价**之前**（实测：只取标记之后会取不到）", () => {
    const fact = computeUnitPriceFact("供应 12 台，单价 86,000 元，合同总价款为 1032000 元。");
    expect(fact).toBeDefined();
    expect(fact?.statement).toContain("12 台");
  });

  it("单价与数量**不同句** → 不产出（跨句会把不相关数字凑成算式）", () => {
    expect(
      computeUnitPriceFact("供应 12 台。单价 86,000 元。合同总价款为 1032000 元。"),
    ).toBeUndefined();
  });

  it("缺总量 / 缺数量 → 不产出", () => {
    expect(computeUnitPriceFact("单价 86,000 元，供应 12 台。")).toBeUndefined();
    expect(computeUnitPriceFact("单价 86,000 元，合同总价款为 1032000 元。")).toBeUndefined();
  });
});

describe("总额前后不一致（同一标记两个值就是硬矛盾）", () => {
  it("同一个「合同标的额」出现两个不同值 → 产出并列出两处", () => {
    const fact = computeTotalConsistencyFact(
      "合同总价款为 1032000 元。\n\n1.2 双方确认合同总价款为 1000000 元。",
    );
    expect(fact?.kind).toBe("total_inconsistent");
    expect(fact?.statement).toContain("数值不一致");
    expect(fact?.statement).toContain("1032000 元");
    expect(fact?.statement).toContain("1000000 元");
  });

  it("多次出现但数值一致 → **不产出**（不是问题就不报）", () => {
    expect(
      computeTotalConsistencyFact(
        "合同总价款为 1032000 元。\n\n1.2 双方确认合同总价款为 1032000 元。",
      ),
    ).toBeUndefined();
  });

  it("**同上标只出现一次 → 不产出**", () => {
    expect(computeTotalConsistencyFact("合同总价款为 1032000 元。")).toBeUndefined();
  });

  it("**不跨句取证**：「已含于总价款内」不会抓到下一条的金额（实测误报）", () => {
    // 「已含于总价款内）」的「总价款」标记 + 下一条的 722,400 曾造成假不一致
    const text = [
      "1.1 合同总价款为 1032000 元。",
      "4.1 合同签订后支付定金 310,000 元（已含于总价款内）。",
      "4.2 全部设备验收合格后支付 722,400 元。",
    ].join("\n");
    expect(computeTotalConsistencyFact(text)).toBeUndefined();
  });
});

describe("付款比例合计（会算出比例不等于 100%）", () => {
  it("恰好 100% → 产出「一致」事实（模型不必自己加）", () => {
    const fact = computePaymentRatioSumFact(
      "1 支付首付款 30%。\n2 验收合格后支付 65%。\n3 余款 5% 于质保期届满后退还。",
    );
    expect(fact?.kind).toBe("payment_ratio_sum");
    expect(fact?.statement).toContain("= 100%");
    expect(fact?.statement).toContain("与全额一致");
  });

  it("合计不足 100% → 算出差额", () => {
    const fact = computePaymentRatioSumFact(
      "1 支付首付款 30%。\n2 验收合格后支付 50%。\n3 余款 5% 于质保期届满后退还。",
    );
    expect(fact?.statement).toContain("= 85%");
    expect(fact?.statement).toContain("少 15 个百分点");
  });

  it("合计超过 100% → 算出差额（会算出来）", () => {
    const fact = computePaymentRatioSumFact("1 支付首付款 60%。\n2 验收合格后支付 50%。");
    expect(fact?.statement).toContain("= 110%");
    expect(fact?.statement).toContain("多 10 个百分点");
  });

  it("**违约金费率不算付款比例**（实测误报：合同总价款的 5% 曾混进来）", () => {
    const fact = computePaymentRatioSumFact(
      "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
    );
    // 只有一条、且在违约语境 → 不产出
    expect(fact).toBeUndefined();
  });

  it("付款与违约两种比例混排时，只计付款侧", () => {
    const fact = computePaymentRatioSumFact(
      [
        "1 支付首付款 30%。",
        "2 验收合格后支付 65%。",
        "3 余款 5% 于质保期届满后退还。",
        "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 支付违约金。",
      ].join("\n"),
    );
    // 30 + 65 + 5 = 100（违约金那条被语境闸排除）
    expect(fact?.statement).toContain("合计");
    expect(fact?.arithmetic.split("\n")[0]).toBe("30 + 65 + 5 = 100");
  });

  it("不在付款语境的百分比不计入", () => {
    expect(computePaymentRatioSumFact("设备精度误差不超过 1%。噪声低于 2%。")).toBeUndefined();
  });

  it("少于两项 → 不产出", () => {
    expect(computePaymentRatioSumFact("1 支付首付款 30%。")).toBeUndefined();
  });
});

describe("扩展后：优先级顺序即丢弃顺序", () => {
  const FULL_CONTRACT = [
    "第一条 标的与价款",
    "1.1 供应精密检测设备 12 台，单价 86,000 元，合同总价款为 1032000 元。",
    "第二条 定金",
    "2.1 甲方向乙方支付定金 310,000 元。",
    "第四条 付款",
    "4.1 支付首付款 30%。",
    "4.2 验收合格后支付 65%。",
    "4.3 余款 5% 于质保期届满后退还。",
    "第五条 违约责任",
    "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
    "5.2 甲方逾期付款的，每逾期一日按逾期金额的 0.05% 向乙方支付违约金。",
  ].join("\n");

  it("七类 computer 全部注册，且顺序稳定", () => {
    const kinds = collectDerivedFacts(FULL_CONTRACT, {
      deliverableType: "contract.review",
      limit: 10,
    }).map((f) => f.kind);
    // deliverable_scope 最前（决定整篇理解），penalty_asymmetry 最后
    expect(kinds[0]).toBe("deliverable_scope");
    expect(kinds).toContain("unit_price_times_quantity");
    expect(kinds).toContain("payment_ratio_sum");
    expect(kinds[kinds.length - 1]).toBe("penalty_asymmetry");
  });

  it("limit 截断保留的是**高优先级**的那几条", () => {
    const kinds = collectDerivedFacts(FULL_CONTRACT, {
      deliverableType: "contract.review",
      limit: 3,
    }).map((f) => f.kind);
    // 前三条＝前三个 computer（顺序即优先级）。
    // 注意 payment_sum 在这里**不产出**：付款条款用的是比例（30%/65%/5%），
    // 没有绝对金额，凑不出「分项合计」——这是正确行为，不是漏算。
    expect(kinds).toEqual(["deliverable_scope", "deposit_cap_ratio", "unit_price_times_quantity"]);
  });
});

describe("日期算术与期限", () => {
  it("日期 + 日（纯日历）", () => {
    expect(addPeriod({ y: 2026, mo: 1, d: 1 }, 30, "day")).toEqual({ y: 2026, mo: 1, d: 31 });
    expect(addPeriod({ y: 2026, mo: 12, d: 25 }, 10, "day")).toEqual({ y: 2027, mo: 1, d: 4 });
  });

  it("**月末夹取**：1 月 31 日 + 1 个月 → 2 月 28 日（不是 3 月 3 日）", () => {
    // 民法的期间届满通常理解是「到期月的对应日，无对应日则月末」，
    // 而 Date.UTC 的自然溢出会算到下一月 —— 那是错的
    expect(addPeriod({ y: 2026, mo: 1, d: 31 }, 1, "month")).toEqual({ y: 2026, mo: 2, d: 28 });
    // 闰年：2024 年 2 月有 29 日
    expect(addPeriod({ y: 2024, mo: 1, d: 31 }, 1, "month")).toEqual({ y: 2024, mo: 2, d: 29 });
  });

  it("年加法的夹取：闰日 + 1 年 → 2 月 28 日", () => {
    expect(addPeriod({ y: 2024, mo: 2, d: 29 }, 1, "year")).toEqual({ y: 2025, mo: 2, d: 28 });
  });

  it("跨年：11 月 + 3 个月 → 次年 2 月", () => {
    expect(addPeriod({ y: 2026, mo: 11, d: 15 }, 3, "month")).toEqual({ y: 2027, mo: 2, d: 15 });
  });

  it("期限届满：显式日期 + 紧随的期间 → 到期日", () => {
    const fact = computeDeadlineFact("乙方应自 2026 年 1 月 1 日起 30 日内完成交付。");
    expect(fact?.kind).toBe("deadline");
    expect(fact?.statement).toContain("2026 年 1 月 31 日");
    expect(fact?.arithmetic).toBe("2026 年 1 月 1 日 + 30 日 = 2026 年 1 月 31 日");
  });

  it("中文数字期间也算得出（十日内 / 三十日）", () => {
    expect(computeDeadlineFact("乙方应自 2026 年 3 月 1 日起十日内交付。")?.statement).toContain(
      "2026 年 3 月 11 日",
    );
    expect(computeDeadlineFact("乙方应自 2026 年 3 月 1 日起三十日内交付。")?.statement).toContain(
      "2026 年 3 月 31 日",
    );
  });

  it("**工作日不折算**（需节假日表，本仓没有 → 不猜）", () => {
    expect(
      computeDeadlineFact("甲方应于 2026 年 1 月 1 日起 5 个工作日内支付定金。"),
    ).toBeUndefined();
  });

  it("**没有显式日期就不产出**（「收到本函之日起十日内」算不出）", () => {
    expect(computeDeadlineFact("请贵司于收到本函之日起十日内完成交付。")).toBeUndefined();
  });

  it("**纯日期不产出**：`2026 年 11 月 30 日前` 不得被读成「11 个月」+「30 日」", () => {
    // 遮蔽日期后，期间正则看不到那些片段
    expect(
      computeDeadlineFact(
        "乙方应于 2026 年 11 月 30 日前交付，并于 2027 年 1 月 15 日前完成验收。",
      ),
    ).toBeUndefined();
  });

  it("日期与期间**隔太远**不算（起点无法确定）", () => {
    expect(
      computeDeadlineFact("乙方应于 2026 年 1 月 1 日签订合同。甲方另有其他安排在 30 日内说明。"),
    ).toBeUndefined();
  });
});

describe("诉讼时效届满日（期间值来自参数库，不是硬编码）", () => {
  it("显式起算日 + 时效语境 → 届满日 = 起算日 + 3 年", () => {
    const fact = computeLimitationDeadlineFact(
      "甲方于 2023 年 5 月 10 日知道权利受到损害。诉讼时效期间如何计算？",
    );
    expect(fact?.kind).toBe("limitation_deadline");
    expect(fact?.statement).toContain("2026 年 5 月 10 日");
    expect(fact?.citations).toEqual([DEFAULT_LIMITATION.source]);
  });

  it("**期间值取自参数库**（民法典第188条 / 3 年），不是写死的字面量", () => {
    const fact = computeLimitationDeadlineFact(
      "甲方于 2020 年 1 月 1 日知道权利受到损害，诉讼时效如何？",
    );
    expect(fact?.arithmetic).toContain(String(DEFAULT_LIMITATION.value));
    expect(fact?.citations[0]).toBe("民法典第188条");
  });

  it("**前提写在产出里**：明说起算点取自语料、其成立与否属法律判断", () => {
    const fact = computeLimitationDeadlineFact(
      "甲方于 2023 年 5 月 10 日知道权利受到损害，诉讼时效如何？",
    );
    expect(fact?.statement).toContain("起算点取自语料原文");
    expect(fact?.statement).toContain("属法律判断");
  });

  it("**不下法律结论**", () => {
    const fact = computeLimitationDeadlineFact(
      "甲方于 2023 年 5 月 10 日知道权利受到损害，诉讼时效如何？",
    );
    for (const w of ["已过时效", "超过时效", "丧失胜诉权", "必须", "应当驳回"]) {
      expect(fact!.statement).not.toContain(w);
    }
  });

  it("无时效语境 → 不产出（普通日期不加 3 年）", () => {
    expect(computeLimitationDeadlineFact("甲方于 2023 年 5 月 10 日支付了货款。")).toBeUndefined();
  });

  it("有语境但无显式日期 → 不产出", () => {
    expect(
      computeLimitationDeadlineFact("甲方知道权利受到损害后一直未主张，诉讼时效如何计算？"),
    ).toBeUndefined();
  });

  it("闰日起算 + 3 年 → 夹到 2 月 28 日", () => {
    expect(
      computeLimitationDeadlineFact("甲方于 2024 年 2 月 29 日知道权利受到损害，诉讼时效如何？")
        ?.statement,
    ).toContain("2027 年 2 月 28 日");
  });
});

describe("九类事实的注册顺序（顺序即优先级）", () => {
  it("日期类排在一致类之后、违约金结构之前", () => {
    const text = [
      "第一条 标的与价款",
      "1.1 供应设备 12 台，单价 86,000 元，合同总价款为 1032000 元。",
      "第二条 定金",
      "2.1 甲方向乙方支付定金 310,000 元。",
      "第三条 交付",
      "3.1 乙方应自 2026 年 1 月 1 日起 30 日内完成交付。",
      "第五条 违约责任",
      "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
      "5.2 甲方逾期付款的，每逾期一日按逾期金额的 0.05% 向乙方支付违约金。",
    ].join("\n");
    const kinds = collectDerivedFacts(text, { deliverableType: "contract.review", limit: 12 }).map(
      (f) => f.kind,
    );
    expect(kinds).toContain("deadline");
    expect(kinds.indexOf("deadline")).toBeLessThan(kinds.indexOf("penalty_asymmetry"));
  });
});

describe("生产装载路径不得按条数静默截断（回归）", () => {
  const FULL = [
    "第一条 标的与价款",
    "1.1 供应设备 12 台，单价 86,000 元，合同总价款为 1032000 元。",
    "第二条 定金",
    "2.1 甲方向乙方支付定金 310,000 元。",
    "第三条 交付",
    "3.1 乙方应自 2026 年 1 月 1 日起 30 日内完成交付。",
    "第四条 付款",
    "4.1 支付首付款 30%。",
    "4.2 验收合格后支付 65%。",
    "4.3 余款 5% 于质保期届满后退还。",
    "第五条 违约责任",
    "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
    "5.2 甲方逾期付款的，每逾期一日按逾期金额的 0.05% 向乙方支付违约金。",
  ].join("\n");

  it("不传 limit 时尾部几类事实**也在**（曾经固定切到 4 条，尾部四类永远到不了渲染器）", () => {
    const kinds = collectDerivedFacts(FULL, { deliverableType: "contract.review" }).map(
      (f) => f.kind,
    );
    // 尾部四类：付款比例合计 / 诉讼时效 / 期限届满 / 违约金结构
    expect(kinds).toContain("payment_ratio_sum");
    expect(kinds).toContain("deadline");
    expect(kinds).toContain("penalty_asymmetry");
    expect(kinds.length).toBeGreaterThan(4);
  });

  it("`loadDerivedFactsForMatter`（生产装载）同样不截断条数，只受材料字符上限约束", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-facts-"));
    try {
      const materialsDir = path.join(workspaceDir, "cases", "matter-1", "materials");
      fs.mkdirSync(materialsDir, { recursive: true });
      fs.writeFileSync(path.join(materialsDir, "contract.md"), FULL, "utf8");

      const kinds = loadDerivedFactsForMatter({
        workspaceDir,
        matterId: "matter-1",
        deliverableType: "contract.review",
      }).map((f) => f.kind);
      expect(kinds).toContain("deliverable_scope");
      expect(kinds).toContain("penalty_asymmetry");
      expect(kinds.length).toBeGreaterThan(4);

      // 显式传 limit 时仍应生效（调用方要硬上界时用得上）
      expect(
        loadDerivedFactsForMatter({
          workspaceDir,
          matterId: "matter-1",
          deliverableType: "contract.review",
          limit: 2,
        }),
      ).toHaveLength(2);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("渲染器的字符预算是**可见**的截断点：放不下的整条丢弃并写明还剩几条", () => {
    const facts = collectDerivedFacts(FULL, { deliverableType: "contract.review" });
    const block = formatDerivedFactsPromptBlock(facts, { maxChars: 400 })!;
    expect(block).toContain("另有");
    expect(block).toContain("未展开");
  });
});

describe("第二类扩展：未做的候选与原因（诚实记录）", () => {
  it("4×LPR **没有**实现——LPR 序列未入库，按「算不出来就不说」不做", () => {
    // 参数库自己写明了这一点（lint/statute-params.ts）
    const blob = collectDerivedFacts("民间借贷利率约定为年利率 24%。", {
      deliverableType: "contract.general",
      limit: 10,
    });
    expect(blob.map((f) => f.kind)).not.toContain("lpr_multiple");
  });
});

describe("七类事实共存时的汇总", () => {
  const FULL = [
    "第一条 标的与价款",
    "1.1 合同总价款为 1032000 元。",
    "第二条 定金",
    "2.1 甲方向乙方支付定金 310,000 元。",
    "第四条 付款",
    "4.1 支付定金 310,000 元。",
    "4.2 验收合格后支付 722,400 元。",
    "第五条 违约责任",
    "5.1 乙方逾期交货的，每逾期一日按合同总价款的 5% 向甲方支付违约金。",
    "5.2 甲方逾期付款的，每逾期一日按逾期金额的 0.05% 向乙方支付违约金。",
  ].join("\n");

  it("limit 生效，且截断保留高优先级", () => {
    const kinds = collectDerivedFacts(FULL, { deliverableType: "contract.review", limit: 8 }).map(
      (f) => f.kind,
    );
    expect(kinds[0]).toBe("deliverable_scope");
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    expect(
      collectDerivedFacts(FULL, { deliverableType: "contract.review", limit: 2 }),
    ).toHaveLength(2);
  });

  it("注入块对多类事实仍然自洽（每条的算式都在括号行里）", () => {
    const block = formatDerivedFactsPromptBlock(
      collectDerivedFacts(FULL, { deliverableType: "contract.review" }),
    )!;
    // 4 条事实 → 4 个括号行（算式与出处合并在一行）
    expect(
      block.split("\n").filter((l) => l.trim().startsWith("（")).length,
    ).toBeGreaterThanOrEqual(3);
    expect(block).not.toContain("必须");
    // 每条事实一行 bullet，一行括号 —— 不再有「算式：」「出处：」「原料：」三行
    expect(block).not.toContain("原料：");
  });
});
