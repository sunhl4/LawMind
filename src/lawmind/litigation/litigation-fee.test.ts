import { describe, expect, it } from "vitest";
import {
  BANKRUPTCY_FEE_CAP_YUAN,
  LITIGATION_FEE_EFFECTIVE_FROM,
  LITIGATION_FEE_SOURCE,
  applyAcceptanceReductions,
  computeAcceptanceFeeForKind,
  computeCaseAcceptanceFee,
  computeExecutionFee,
  computePreservationFee,
  formatFeeYuan,
} from "./litigation-fee.js";

/** 官方「简易公式」（标的 × 费率 + 常数）用于交叉验证分段累计结果。 */
function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(0.01);
}

describe("财产案件受理费（第十三条第（一）项）", () => {
  it("charges the flat 50 元 at or below 1 万元", () => {
    expectClose(computeCaseAcceptanceFee(5_000).amountYuan, 50);
    expectClose(computeCaseAcceptanceFee(10_000).amountYuan, 50);
  });

  it("matches the official 标的×费率+常数 简易公式 at every tier boundary", () => {
    // 1 万–10 万：标的×2.5% − 200
    expectClose(computeCaseAcceptanceFee(20_000).amountYuan, 20_000 * 0.025 - 200);
    // 10 万–20 万：标的×2% + 300
    expectClose(computeCaseAcceptanceFee(150_000).amountYuan, 150_000 * 0.02 + 300);
    // 20 万–50 万：标的×1.5% + 1300
    expectClose(computeCaseAcceptanceFee(300_000).amountYuan, 300_000 * 0.015 + 1_300);
    // 100 万–200 万：标的×0.9% + 4800
    expectClose(computeCaseAcceptanceFee(2_000_000).amountYuan, 2_000_000 * 0.009 + 4_800);
    // 200 万–500 万：标的×0.8% + 6800
    expectClose(computeCaseAcceptanceFee(5_000_000).amountYuan, 5_000_000 * 0.008 + 6_800);
  });

  it("keeps accumulating past 2000 万元 at 0.5%", () => {
    const at20m = computeCaseAcceptanceFee(20_000_000).amountYuan;
    const at30m = computeCaseAcceptanceFee(30_000_000).amountYuan;
    expectClose(at30m - at20m, 10_000_000 * 0.005);
  });

  it("explains the formula with per-tier hits", () => {
    const fee = computeCaseAcceptanceFee(20_000);
    expect(fee.formula).toContain("50");
    expect(fee.formula).toContain("2.5%");
    expect(fee.breakdown).toHaveLength(2);
  });
});

describe("保全申请费（第十四条第（二）项）", () => {
  it("charges 30 元 flat at or below 1000 元", () => {
    expectClose(computePreservationFee(1_000).amountYuan, 30);
    expectClose(computePreservationFee(0).amountYuan, 30);
  });

  it("charges 1% above 1000 元 and 0.5% above 10 万元", () => {
    expectClose(computePreservationFee(100_000).amountYuan, (100_000 - 1_000) * 0.01);
    expectClose(
      computePreservationFee(200_000).amountYuan,
      (100_000 - 1_000) * 0.01 + (200_000 - 100_000) * 0.005,
    );
  });

  it("enforces the 5000 元 statutory cap", () => {
    const high = computePreservationFee(1_000_000);
    expect(high.amountYuan).toBe(5_000);
    expect(high.capped).toBe(true);
    expect(computePreservationFee(2_000_000).amountYuan).toBe(5_000);
  });
});

describe("执行申请费（第十四条第（一）项 2）", () => {
  it("charges 50 元 flat at or below 1 万元, then 1.5%", () => {
    expectClose(computeExecutionFee(5_000).amountYuan, 50);
    expectClose(computeExecutionFee(110_000).amountYuan, 50 + 100_000 * 0.015);
  });
});

describe("非财产案件与特殊案件（幅度不猜数）", () => {
  it("returns a range for 离婚 rather than a fabricated single value", () => {
    const fee = computeAcceptanceFeeForKind("divorce");
    expect(fee.kind).toBe("range");
    if (fee.kind === "range") {
      expect(fee.minYuan).toBe(50);
      expect(fee.maxYuan).toBe(300);
      expect(fee.note).toContain("省级政府");
    }
  });

  it("adds 0.5% on 离婚 marital property above 20 万元", () => {
    const fee = computeAcceptanceFeeForKind("divorce", { maritalPropertyYuan: 500_000 });
    if (fee.kind === "range") {
      expectClose(fee.minYuan, 50 + 300_000 * 0.005);
      expectClose(fee.maxYuan, 300 + 300_000 * 0.005);
    }
  });

  it("charges 劳动争议 10 元 and 其他行政案件 50 元", () => {
    expect(computeAcceptanceFeeForKind("labor")).toMatchObject({ kind: "exact", amountYuan: 10 });
    expect(computeAcceptanceFeeForKind("administrative_other")).toMatchObject({
      kind: "exact",
      amountYuan: 50,
    });
  });

  it("computes 支付令 as 1/3 of the property acceptance fee", () => {
    const fee = computeAcceptanceFeeForKind("payment_order", { claimAmountYuan: 150_000 });
    if (fee.kind === "exact") {
      expectClose(fee.amountYuan, computeCaseAcceptanceFee(150_000).amountYuan / 3);
    }
  });

  it("halves 破产 and caps it at 30 万元", () => {
    const fee = computeAcceptanceFeeForKind("bankruptcy", { claimAmountYuan: 1_000_000 });
    if (fee.kind === "exact") {
      expectClose(fee.amountYuan, computeCaseAcceptanceFee(1_000_000).amountYuan / 2);
    }
    const huge = computeAcceptanceFeeForKind("bankruptcy", { claimAmountYuan: 1_000_000_000 });
    if (huge.kind === "exact") {
      expect(huge.amountYuan).toBe(BANKRUPTCY_FEE_CAP_YUAN);
    }
  });

  it("asks for the amount instead of guessing when 财产案件 has none", () => {
    const fee = computeAcceptanceFeeForKind("property");
    if (fee.kind === "range") {
      expect(fee.note).toContain("诉讼请求金额");
    }
  });
});

describe("减半（第十五条、第十六条）", () => {
  it("halves for 调解/撤诉 and for 简易程序, citing the source", () => {
    const fee = computeCaseAcceptanceFee(150_000);
    const reductions = applyAcceptanceReductions(fee, {
      mediationOrWithdrawal: true,
      simplified: true,
    });
    expect(reductions).toHaveLength(2);
    for (const row of reductions) {
      expectClose(row.amountYuan, fee.amountYuan / 2);
      expect(row.source).toContain("诉讼费用交纳办法");
    }
    expect(reductions[0]?.source).toContain("第十五条");
    expect(reductions[1]?.source).toContain("第十六条");
  });

  it("does not halve when no condition applies", () => {
    expect(applyAcceptanceReductions(computeCaseAcceptanceFee(150_000))).toEqual([]);
  });
});

describe("版本与出处", () => {
  it("carries source + effectiveFrom so a wrong rate cannot silently drift", () => {
    expect(LITIGATION_FEE_SOURCE).toContain("诉讼费用交纳办法");
    expect(LITIGATION_FEE_EFFECTIVE_FROM).toBe("2007-04-01");
  });

  it("formats amounts for lawyer-facing display", () => {
    expect(formatFeeYuan(13_800)).toBe("13,800 元");
  });
});
