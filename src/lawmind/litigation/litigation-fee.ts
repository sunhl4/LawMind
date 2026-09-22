/**
 * 诉讼费估算（中国大陆）——《诉讼费用交纳办法》（国务院令第481号，2007-04-01 施行）。
 *
 * 为什么单独成模块并锁版本：SECURITY.md 明确「错误的法定参数比没有规则更糟」。
 * 费率表逐档带 source + effectiveFrom，任何改动都必须在这里留痕。
 *
 * 本模块**只做确定性算术**，不做法律判断：
 *   - 幅度类收费（离婚 50–300 元、人格权 100–500 元等）由省级政府在幅度内定标准，
 *     因此返回 `range` 而不是猜一个数；
 *   - 减半只按办法第十五条（调解结案/撤诉）与第十六条（简易程序）实现；
 *   - 保全费不因简易程序自动减半（办法未规定）。
 */

export const LITIGATION_FEE_SOURCE = "诉讼费用交纳办法（国务院令第481号）";
export const LITIGATION_FEE_EFFECTIVE_FROM = "2007-04-01";
export const LITIGATION_FEE_VERSION = 1;

export type FeeTier = {
  /** 该档上限（元）；null 表示无上限。 */
  upToYuan: number | null;
  /** 该档费率；null 表示该档为定额。 */
  rate: number | null;
  /** 定额（元），与 rate 互斥。 */
  flatYuan?: number;
  note: string;
};

/**
 * 第十三条第（一）项：财产案件受理费，按诉讼请求金额**分段累计**。
 * 第 1 档为定额 50 元（≤1 万元），其余为超出部分的费率。
 */
export const PROPERTY_ACCEPTANCE_TIERS: readonly FeeTier[] = [
  { upToYuan: 10_000, rate: null, flatYuan: 50, note: "不超过 1 万元的，每件交纳 50 元" },
  { upToYuan: 100_000, rate: 0.025, note: "超过 1 万元至 10 万元的部分，按 2.5%" },
  { upToYuan: 200_000, rate: 0.02, note: "超过 10 万元至 20 万元的部分，按 2%" },
  { upToYuan: 500_000, rate: 0.015, note: "超过 20 万元至 50 万元的部分，按 1.5%" },
  { upToYuan: 1_000_000, rate: 0.01, note: "超过 50 万元至 100 万元的部分，按 1%" },
  { upToYuan: 2_000_000, rate: 0.009, note: "超过 100 万元至 200 万元的部分，按 0.9%" },
  { upToYuan: 5_000_000, rate: 0.008, note: "超过 200 万元至 500 万元的部分，按 0.8%" },
  { upToYuan: 10_000_000, rate: 0.007, note: "超过 500 万元至 1000 万元的部分，按 0.7%" },
  { upToYuan: 20_000_000, rate: 0.006, note: "超过 1000 万元至 2000 万元的部分，按 0.6%" },
  { upToYuan: null, rate: 0.005, note: "超过 2000 万元的部分，按 0.5%" },
];

/** 第十四条第（二）项：保全申请费。1 千元以下 30 元；1 千–10 万 1%；超 10 万 0.5%；上限 5000 元。 */
export const PRESERVATION_FLAT_YUAN = 30;
export const PRESERVATION_RATE_MID = 0.01;
export const PRESERVATION_RATE_HIGH = 0.005;
export const PRESERVATION_MID_YUAN = 100_000;
export const PRESERVATION_CAP_YUAN = 5_000;

/** 第十四条第（一）项 2：执行申请费。 */
export const EXECUTION_TIERS: readonly FeeTier[] = [
  { upToYuan: 10_000, rate: null, flatYuan: 50, note: "不超过 1 万元的，每件交纳 50 元" },
  { upToYuan: 500_000, rate: 0.015, note: "超过 1 万元至 50 万元的部分，按 1.5%" },
  { upToYuan: 5_000_000, rate: 0.01, note: "超过 50 万元至 500 万元的部分，按 1%" },
  { upToYuan: 10_000_000, rate: 0.005, note: "超过 500 万元至 1000 万元的部分，按 0.5%" },
  { upToYuan: null, rate: 0.001, note: "超过 1000 万元的部分，按 0.1%" },
];

/** 破产案件受理费上限（第十四条第（六）项）。 */
export const BANKRUPTCY_FEE_CAP_YUAN = 300_000;

export type FeeTierHit = { tier: FeeTier; baseYuan: number; amountYuan: number };

export type ExactFee = {
  kind: "exact";
  amountYuan: number;
  formula: string;
  breakdown: FeeTierHit[];
};

export type RangeFee = {
  kind: "range";
  minYuan: number;
  maxYuan: number;
  formula: string;
  note: string;
};

export type FeeComputation = ExactFee | RangeFee;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 按分段累计计算；返回各档命中明细便于展示公式。 */
export function computeTieredFee(amountYuan: number, tiers: readonly FeeTier[]): ExactFee {
  const amount = Math.max(0, amountYuan);
  const breakdown: FeeTierHit[] = [];
  let lower = 0;
  let total = 0;
  for (const tier of tiers) {
    const upper = tier.upToYuan ?? Number.POSITIVE_INFINITY;
    if (amount <= lower) {
      break;
    }
    const base = Math.min(amount, upper) - lower;
    if (base <= 0) {
      break;
    }
    const fee = tier.flatYuan ?? base * (tier.rate ?? 0);
    // 第 1 档定额：金额落在该档就是 50 元，不再按比例。
    total += fee;
    breakdown.push({ tier, baseYuan: round2(base), amountYuan: round2(fee) });
    if (amount <= upper) {
      break;
    }
    lower = upper;
  }
  return {
    kind: "exact",
    amountYuan: round2(total),
    formula: formatTierFormula(breakdown),
    breakdown,
  };
}

function formatTierFormula(breakdown: FeeTierHit[]): string {
  return breakdown
    .map((hit) =>
      hit.tier.flatYuan != null
        ? `50 元（≤1 万元的部分）`
        : `${hit.baseYuan} 元 × ${((hit.tier.rate ?? 0) * 100).toFixed(1)}% = ${hit.amountYuan} 元`,
    )
    .join(" + ");
}

/** 财产案件受理费（第十三条第（一）项）。 */
export function computeCaseAcceptanceFee(claimAmountYuan: number): ExactFee {
  return computeTieredFee(claimAmountYuan, PROPERTY_ACCEPTANCE_TIERS);
}

/** 保全申请费（第十四条第（二）项），含 5000 元上限。 */
export function computePreservationFee(
  preservedAmountYuan: number,
): ExactFee & { capped: boolean } {
  const amount = Math.max(0, preservedAmountYuan);
  let fee: number;
  let formula: string;
  if (amount <= 1_000) {
    fee = PRESERVATION_FLAT_YUAN;
    formula = `${PRESERVATION_FLAT_YUAN} 元（≤1000 元或不涉及财产数额）`;
  } else if (amount <= PRESERVATION_MID_YUAN) {
    fee = (amount - 1_000) * PRESERVATION_RATE_MID;
    formula = `(${amount} − 1000) × 1% = ${round2(fee)} 元`;
  } else {
    const first = (PRESERVATION_MID_YUAN - 1_000) * PRESERVATION_RATE_MID;
    const rest = (amount - PRESERVATION_MID_YUAN) * PRESERVATION_RATE_HIGH;
    fee = first + rest;
    formula = `(100000 − 1000) × 1% + (${amount} − 100000) × 0.5% = ${round2(fee)} 元`;
  }
  const capped = fee > PRESERVATION_CAP_YUAN;
  if (capped) {
    formula += `；超过上限，按 ${PRESERVATION_CAP_YUAN} 元计`;
    fee = PRESERVATION_CAP_YUAN;
  }
  return {
    kind: "exact",
    amountYuan: round2(fee),
    formula,
    breakdown: [],
    capped,
  };
}

/** 执行申请费（第十四条第（一）项 2）。 */
export function computeExecutionFee(executionAmountYuan: number): ExactFee {
  return computeTieredFee(executionAmountYuan, EXECUTION_TIERS);
}

export type FeeReduction = {
  /** 对折原因，对应办法条文。 */
  reason: string;
  source: string;
  amountYuan: number;
  originalYuan: number;
};

/**
 * 第十三条各档费率表（供 UI 展示「全额 / 减半」对照）。
 * 减半依据：第十五条（调解结案或撤诉）、第十六条（简易程序）。
 */
export function applyAcceptanceReductions(
  fee: ExactFee,
  opts?: { simplified?: boolean; mediationOrWithdrawal?: boolean },
): FeeReduction[] {
  const out: FeeReduction[] = [];
  const half = () => round2(fee.amountYuan / 2);
  if (opts?.mediationOrWithdrawal) {
    out.push({
      reason: "调解结案或撤诉",
      source: `${LITIGATION_FEE_SOURCE}第十五条`,
      amountYuan: half(),
      originalYuan: fee.amountYuan,
    });
  }
  if (opts?.simplified) {
    out.push({
      reason: "适用简易程序",
      source: `${LITIGATION_FEE_SOURCE}第十六条`,
      amountYuan: half(),
      originalYuan: fee.amountYuan,
    });
  }
  return out;
}

export type LitigationCaseKind =
  | "property"
  | "divorce"
  | "personality_right"
  | "other_non_property"
  | "ip"
  | "labor"
  | "administrative_ip"
  | "administrative_other"
  | "jurisdiction_objection"
  | "bankruptcy"
  | "payment_order";

export const LITIGATION_CASE_KIND_LABELS: Record<LitigationCaseKind, string> = {
  property: "财产案件",
  divorce: "离婚案件",
  personality_right: "人格权案件",
  other_non_property: "其他非财产案件",
  ip: "知识产权民事案件",
  labor: "劳动争议案件",
  administrative_ip: "商标/专利/海事行政案件",
  administrative_other: "其他行政案件",
  jurisdiction_objection: "管辖权异议（异议不成立）",
  bankruptcy: "破产案件",
  payment_order: "支付令",
};

/**
 * 案件受理费。
 * 幅度类（离婚/人格权/其他非财产/行政/管辖权异议）返回 range；财产与劳动争议为定额或分段。
 */
export function computeAcceptanceFeeForKind(
  kind: LitigationCaseKind,
  opts: {
    claimAmountYuan?: number;
    /** 离婚：财产分割总额（超过 20 万部分加收 0.5%）。 */
    maritalPropertyYuan?: number;
    /** 人格权：请求赔偿金额（超过 5 万部分加收）。 */
    damagesYuan?: number;
  } = {},
): FeeComputation {
  const amount = opts.claimAmountYuan;
  switch (kind) {
    case "property": {
      if (amount == null) {
        return {
          kind: "range",
          minYuan: 0,
          maxYuan: 0,
          formula: "需要诉讼请求金额",
          note: "财产案件受理费按诉讼请求金额分段累计；请先确定请求金额。",
        };
      }
      return computeCaseAcceptanceFee(amount);
    }
    case "labor":
      return {
        kind: "exact",
        amountYuan: 10,
        formula: "每件 10 元",
        breakdown: [],
      };
    case "divorce": {
      const property = Math.max(0, opts.maritalPropertyYuan ?? 0);
      const extra = property > 200_000 ? round2((property - 200_000) * 0.005) : 0;
      return {
        kind: "range",
        minYuan: round2(50 + extra),
        maxYuan: round2(300 + extra),
        formula: extra > 0 ? `50–300 元 + (${property} − 200000) × 0.5%` : "每件 50–300 元",
        note:
          "离婚案件每件 50–300 元，具体标准由省级政府在幅度内制定。" +
          (extra > 0
            ? "财产总额超过 20 万元的部分按 0.5% 另交。"
            : "财产总额不超过 20 万元不另交。"),
      };
    }
    case "personality_right": {
      const damages = Math.max(0, opts.damagesYuan ?? 0);
      let extra = 0;
      if (damages > 50_000) {
        extra += (Math.min(damages, 100_000) - 50_000) * 0.01;
      }
      if (damages > 100_000) {
        extra += (damages - 100_000) * 0.005;
      }
      return {
        kind: "range",
        minYuan: round2(100 + extra),
        maxYuan: round2(500 + extra),
        formula: extra > 0 ? `100–500 元 + 赔偿额附加 = ${round2(extra)} 元` : "每件 100–500 元",
        note:
          "人格权案件每件 100–500 元，具体标准由省级政府制定。" +
          "赔偿金额不超过 5 万元不另交；5 万–10 万部分按 1%，超 10 万部分按 0.5%。",
      };
    }
    case "other_non_property":
      return {
        kind: "range",
        minYuan: 50,
        maxYuan: 100,
        formula: "每件 50–100 元",
        note: "其他非财产案件每件 50–100 元，具体标准由省级政府制定。",
      };
    case "ip": {
      if (amount == null) {
        return {
          kind: "range",
          minYuan: 500,
          maxYuan: 1_000,
          formula: "每件 500–1000 元",
          note: "知识产权民事案件没有争议金额的，每件 500–1000 元。",
        };
      }
      return computeCaseAcceptanceFee(amount);
    }
    case "administrative_ip":
      return { kind: "exact", amountYuan: 100, formula: "每件 100 元", breakdown: [] };
    case "administrative_other":
      return { kind: "exact", amountYuan: 50, formula: "每件 50 元", breakdown: [] };
    case "jurisdiction_objection":
      return {
        kind: "range",
        minYuan: 50,
        maxYuan: 100,
        formula: "每件 50–100 元",
        note: "管辖权异议不成立的，每件 50–100 元，具体标准由省级政府制定。",
      };
    case "payment_order": {
      if (amount == null) {
        return {
          kind: "range",
          minYuan: 0,
          maxYuan: 0,
          formula: "需要请求金额",
          note: "支付令申请费比照财产案件受理费标准的 1/3；请先确定请求金额。",
        };
      }
      const base = computeCaseAcceptanceFee(amount);
      const fee = round2(base.amountYuan / 3);
      return {
        kind: "exact",
        amountYuan: fee,
        formula: `${base.amountYuan} 元 ÷ 3 = ${fee} 元（比照财产案件受理费 1/3）`,
        breakdown: base.breakdown,
      };
    }
    case "bankruptcy": {
      if (amount == null) {
        return {
          kind: "range",
          minYuan: 0,
          maxYuan: BANKRUPTCY_FEE_CAP_YUAN,
          formula: "按破产财产总额减半，最高 30 万元",
          note: "破产案件按财产案件受理费标准减半交纳，最高不超过 30 万元。",
        };
      }
      const base = computeCaseAcceptanceFee(amount);
      const halved = round2(base.amountYuan / 2);
      const capped = Math.min(halved, BANKRUPTCY_FEE_CAP_YUAN);
      return {
        kind: "exact",
        amountYuan: capped,
        formula: `${base.amountYuan} 元 ÷ 2 = ${halved} 元${capped < halved ? "，超过上限按 30 万元" : ""}`,
        breakdown: base.breakdown,
      };
    }
    default:
      return {
        kind: "range",
        minYuan: 0,
        maxYuan: 0,
        formula: "未支持的案件类型",
        note: "本模块未收录该类型；请按办法原文核算。",
      };
  }
}

export function formatFeeYuan(n: number): string {
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 元`;
}
