/**
 * 方向 3「记性抽查」（witness）第一步：只读探针，不接生成回路。
 *
 * docs/量子启发.md §二(3)。本模块只做两件事：
 * 1. 从账本确定性生成探针问题。问题文本不得内嵌账本答案，否则「答对」
 *    失去检验意义；答案由引擎持有，回答在引擎侧比对。
 * 2. 对回答打分并产出观察报告。报告是观测，不是证据：不回写 FactorState、
 *    不改稿、不触发重采样；压缩前后配对回放由上层实验负责。
 *
 * 每次采样前账本读数已由 deriveModelMessagesForSampling 重画（session.ts），
 * 因此这里的失败只表达「注入的读数块没有被正确取用」，不重复承担重注职责。
 */

import { STATED_AMOUNT_PREFIX, projectReading, type FactorState } from "./factor-state.js";

export type WitnessProbeKind = "amount" | "defined" | "citation" | "unverified";

export type WitnessProbe = {
  kind: WitnessProbeKind;
  /** 探针针对的账本锚。 */
  anchor: string;
  /** 给受测模型的问题。value/mention 模式下不含答案；hedged 模式不含数值。 */
  question: string;
  /**
   * value/mention 模式的期望读数；unverified 模式留空。
   * expected 永不出现在 question 里。
   */
  expected: string;
};

export type WitnessAnswerVerdict = "pass" | "drift";

export type WitnessScore = {
  anchor: string;
  kind: WitnessProbeKind;
  verdict: WitnessAnswerVerdict;
  detail: string;
};

export type WitnessReport = {
  probes: number;
  scores: WitnessScore[];
  verdict: WitnessAnswerVerdict;
  /** 打分为 drift 的锚，供只记录通道刷新观察；处置仍由引擎侧决定。 */
  driftAnchors: string[];
};

const AMOUNT_LABELS: Record<string, string> = {
  economic_compensation: "经济补偿",
  interest: "利息",
  wage: "月工资",
  litigation_fee: "诉讼费",
  liquidated_damages: "违约金",
};

const HEDGE_WORDS = ["待核实", "不确定", "无法确认", "不能确定"];

/** 「47条」这类序号不算金额；只有带万/元或 ≥4 位数字才算候选。 */
export function moneyCandidates(text: string): number[] {
  const values: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*万)?(\s*元)?/g;
  for (const match of text.matchAll(re)) {
    const digits = (match[1] ?? "").replace(/,/g, "");
    const wan = Boolean(match[2]);
    const yuan = Boolean(match[3]);
    if (!digits) {
      continue;
    }
    const long = digits.length >= 4 || digits.includes(".");
    if (!wan && !yuan && !long) {
      continue;
    }
    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    values.push(Math.round(parsed * (wan ? 10000 : 1)));
  }
  return values;
}

/** 解析账本里形如「88000」「8.8万」「480万元」的金额读数。 */
export function parseMoneyYuan(value: string): number | undefined {
  const cleaned = value.replace(/,/g, "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(万)?\s*(元)?$/.exec(cleaned);
  if (!m?.[1]) {
    return undefined;
  }
  const parsed = Number(m[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const wan = m[2] !== undefined;
  return Math.round(parsed * (wan ? 10000 : 1));
}

function definiteValue(state: FactorState, anchor: string): string | undefined {
  const factor = state.factors.find((item) => item.anchor === anchor);
  if (!factor) {
    return undefined;
  }
  const reading = projectReading(factor.outcomes);
  if (reading.kind !== "definite") {
    return undefined;
  }
  return reading.id.trim() || undefined;
}

function amountLabel(anchor: string): string {
  const op = anchor.replace(/^amount:/, "");
  return AMOUNT_LABELS[op] ?? op.replace(/_/g, " ");
}

/**
 * 风险优先的探针集：conflict / mixed 先测，普通已核槽随后；上限默认 3 个。
 * amount:stated: 前缀是回合临时转述，不进探针。
 */
export function buildWitnessProbes(state: FactorState, limit = 3): WitnessProbe[] {
  if (limit <= 0) {
    return [];
  }
  type Ranked = { rank: number; probe: WitnessProbe };
  const ranked: Ranked[] = [];
  const flagRisk = (flag: string): number => {
    if (flag === "uncorrectable" || flag === "conflict") {
      return 0;
    }
    if (flag === "mixed") {
      return 1;
    }
    return 2;
  };
  const citationIndex = new Map<string, number>();
  let citationCount = 0;
  for (const factor of state.factors) {
    if (factor.kind === "citation") {
      citationCount += 1;
      citationIndex.set(factor.anchor, citationCount);
    }
  }
  for (const factor of state.factors) {
    const rank = flagRisk(factor.flag);
    const anchor = factor.anchor;
    if (anchor.startsWith(STATED_AMOUNT_PREFIX)) {
      continue;
    }
    if (factor.kind === "amount") {
      const definite = definiteValue(state, anchor);
      if (definite === undefined) {
        const label = amountLabel(anchor);
        ranked.push({
          rank,
          probe: {
            kind: "unverified",
            anchor,
            question: `按引擎账本（【引擎核定】清单），${label}目前是否已有唯一已核数值？若有，只报该数值；若没有唯一已核值，请直接回答【待核实】。`,
            expected: "",
          },
        });
        continue;
      }
      const yuan = parseMoneyYuan(definite);
      if (yuan === undefined) {
        continue;
      }
      const label = amountLabel(anchor);
      ranked.push({
        rank,
        probe: {
          kind: "amount",
          anchor,
          question: `按引擎账本（【引擎核定】清单），${label}的已核金额是多少？只报金额数字与单位，不要引用上文原句。`,
          expected: definite,
        },
      });
      continue;
    }
    if (anchor.startsWith("defined:")) {
      const term = anchor.slice("defined:".length);
      const definite = definiteValue(state, anchor);
      if (definite === undefined) {
        ranked.push({
          rank,
          probe: {
            kind: "unverified",
            anchor,
            question: `按引擎账本，本件中「${term}」的定义目前是否有唯一已核表述？若有，只报该表述；若没有唯一已核值，请直接回答【待核实】。`,
            expected: "",
          },
        });
        continue;
      }
      // 读数只是简称本身时，探针测不出「定义是否被取用」（任何含简称的
      // 回答都命中），跳过，避免产生无信息量的观测。
      if (definite === term) {
        continue;
      }
      ranked.push({
        rank,
        probe: {
          kind: "defined",
          anchor,
          question: `按引擎账本，本件中「${term}」的定义指向哪一主体或内容？只报账本已核的对应表述。`,
          expected: definite,
        },
      });
      continue;
    }
    if (factor.kind === "citation") {
      const id = anchor.replace(/^citation:/, "");
      if (!id) {
        continue;
      }
      const position = citationIndex.get(anchor) ?? citationCount;
      ranked.push({
        rank,
        probe: {
          kind: "citation",
          anchor,
          question: `按引擎账本的引用清单，其中第 ${position} 条引用的来源短 id 是什么？只报该短 id，不要解释。`,
          expected: id,
        },
      });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, limit).map((row) => row.probe);
}

/** 打分只在引擎侧比对；回答文本不落账本、不进历史。 */
export function scoreWitnessAnswer(probe: WitnessProbe, answer: string): WitnessScore {
  const trimmed = answer.trim();
  const fail = (detail: string): WitnessScore => ({
    anchor: probe.anchor,
    kind: probe.kind,
    verdict: "drift",
    detail,
  });
  const pass = (detail: string): WitnessScore => ({
    anchor: probe.anchor,
    kind: probe.kind,
    verdict: "pass",
    detail,
  });
  if (!trimmed) {
    return fail("空回答");
  }
  if (probe.kind === "unverified") {
    if (HEDGE_WORDS.some((word) => trimmed.includes(word))) {
      return pass("按账本承认未核实");
    }
    const values = moneyCandidates(trimmed);
    if (values.length > 0) {
      return fail("未核锚写成了确定数值");
    }
    return fail("未核锚未承认不确定");
  }
  if (probe.kind === "amount") {
    const expected = parseMoneyYuan(probe.expected);
    if (expected === undefined) {
      return fail("账本读数无法解析为金额");
    }
    const values = [...new Set(moneyCandidates(trimmed))];
    if (values.length > 1) {
      return fail("回答中出现多个候选金额");
    }
    if (values[0] === undefined) {
      return fail("回答中没有可核对的金额");
    }
    return values[0] === expected
      ? pass("与账本已核金额一致")
      : fail(`写成了 ${values[0]}，账本是 ${expected}`);
  }
  // defined / citation：期望是一个字符串读数，包含即算取用成功。
  const expected = probe.expected.trim();
  if (!expected) {
    return fail("账本读数为空");
  }
  return trimmed.includes(expected) ? pass("与账本已核读数一致") : fail("回答与账本已核读数不一致");
}

/** 汇总为观察报告。verdict=drift 只表达「读数块没有被取用」，处置在引擎侧。 */
export function witnessReport(scores: readonly WitnessScore[]): WitnessReport {
  const driftAnchors = [
    ...new Set(scores.filter((s) => s.verdict === "drift").map((s) => s.anchor)),
  ];
  return {
    probes: scores.length,
    scores: [...scores],
    verdict: driftAnchors.length === 0 ? "pass" : "drift",
    driftAnchors,
  };
}
