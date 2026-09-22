/**
 * Compile-stage 期限: parse kind + start date, run computeLegalPeriod.
 * Incomplete dates stay 待补. Mail/Word paths do not use this.
 */

import { parseFirstYmd } from "../reasoning/cn-date.js";
import {
  computeLegalPeriod,
  type LegalPeriodKind,
  type LegalPeriodResult,
} from "./legal-period.js";

export type PeriodCalcFill = {
  kind?: LegalPeriodKind;
  start?: string;
  result?: LegalPeriodResult;
  gaps: string[];
};

function inferKind(instruction: string): LegalPeriodKind | undefined {
  if (/上诉期/.test(instruction)) {
    return "civil_appeal";
  }
  if (/答辩期/.test(instruction)) {
    return "civil_answer";
  }
  if (/申请仲裁|仲裁时效/.test(instruction)) {
    return "labor_arbitration_apply";
  }
  if (/裁决.{0,12}起诉|起诉期/.test(instruction) && /劳动/.test(instruction)) {
    return "labor_award_sue";
  }
  if (/再审/.test(instruction)) {
    return "civil_retrial";
  }
  if (/申请执行|执行时效/.test(instruction)) {
    return "execution";
  }
  return undefined;
}

export function extractPeriodCalcFill(instruction: string): PeriodCalcFill {
  const kind = inferKind(instruction);
  const start = parseFirstYmd(instruction);
  const gaps: string[] = [];
  if (!kind) {
    gaps.push("期间种类");
  }
  if (!start) {
    gaps.push("起算日（须到日）");
  }
  const fill: PeriodCalcFill = { kind, start, gaps };
  if (kind && start) {
    const computed = computeLegalPeriod(kind, start);
    if ("expires" in computed) {
      fill.result = computed;
    } else {
      gaps.push(computed.error);
    }
  }
  return fill;
}

export function formatPeriodCalcBody(fill: PeriodCalcFill): string {
  if (fill.result) {
    return [
      `种类：${fill.result.kind}。起算：${fill.result.start}。`,
      `届满日：${fill.result.expires}。公式：${fill.result.formula}。`,
      ...fill.result.notes.map((n) => `- ${n}`),
    ].join("\n");
  }
  return [
    `种类：${fill.kind ?? "【待补充】"}。起算日：${fill.start ?? "【待补充】"}。`,
    `缺 ${fill.gaps.join("、") || "槽位"}，未代算届满日。不要口算。`,
  ].join("\n");
}
