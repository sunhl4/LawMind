/**
 * Compile-stage labor amounts: parse slots from the instruction, run the rule engine.
 * Missing slots stay 待补; never invent wage or years. Mail/Word paths do not use this.
 */

import { toYmd } from "../reasoning/cn-date.js";
import {
  computeEconomicCompensation,
  type EconomicCompensationKind,
} from "./economic-compensation.js";
import { computeLegalPeriod, type LegalPeriodResult } from "./legal-period.js";
import { computeOvertimePay, type OvertimeKind } from "./overtime-pay.js";

const ARBITRATION_START_RE = /解除|离职|侵害|送达|终止|裁员/;
const DATE_RE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;

export type LaborCalcFill = {
  kind?: EconomicCompensationKind;
  yearsOfService?: number;
  monthlyWageYuan?: number;
  compensation?: ReturnType<typeof computeEconomicCompensation>;
  overtimeHours?: number;
  overtimeKind?: OvertimeKind;
  overtime?: ReturnType<typeof computeOvertimePay>;
  arbitration?: LegalPeriodResult;
  gaps: string[];
};

function parseWageYuan(instruction: string): number | undefined {
  const wan = instruction.match(/月(?:薪|工资|工资额)\s*(\d+(?:\.\d+)?)\s*万/);
  if (wan?.[1]) {
    const n = Number(wan[1]) * 10_000;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const yuan = instruction.match(/(?:月薪|月工资|工资)\s*(?:为|是|:|：)?\s*(\d{3,7})(?:\s*元)?/);
  if (yuan?.[1]) {
    const n = Number(yuan[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function parseYears(instruction: string): number | undefined {
  const a = instruction.match(/工作(?:了|满)?\s*(\d+(?:\.\d+)?)\s*年/);
  const b = instruction.match(/工龄\s*(\d+(?:\.\d+)?)\s*年/);
  const c = instruction.match(/(\d+(?:\.\d+)?)\s*年(?:工龄|工作)/);
  const raw = a?.[1] ?? b?.[1] ?? c?.[1];
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : undefined;
}

function parseKind(instruction: string): EconomicCompensationKind | undefined {
  if (/违法解除|2\s*N\b|经济补偿的二倍/.test(instruction)) {
    return "2N";
  }
  if (/代通知金|N\s*\+\s*1/.test(instruction)) {
    return "N+1";
  }
  if (/经济补偿|解除劳动合同/.test(instruction)) {
    return "N";
  }
  return undefined;
}

function parseOvertime(instruction: string): { hours: number; kind: OvertimeKind } | undefined {
  const hoursHit = instruction.match(/加班\s*(\d+(?:\.\d+)?)\s*小时/);
  if (!hoursHit?.[1]) {
    return undefined;
  }
  const hours = Number(hoursHit[1]);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 400) {
    return undefined;
  }
  let kind: OvertimeKind = "weekday";
  if (/法定假|节假日/.test(instruction)) {
    kind = "statutory_holiday";
  } else if (/休息日|周末/.test(instruction)) {
    kind = "rest_day";
  }
  return { hours, kind };
}

function parseArbitrationStart(instruction: string): string | undefined {
  const re = new RegExp(DATE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(instruction)) !== null) {
    const ymd = toYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!ymd) {
      continue;
    }
    const before = instruction.slice(Math.max(0, m.index - 6), m.index);
    const after = instruction.slice(m.index + m[0].length, m.index + m[0].length + 10);
    if (ARBITRATION_START_RE.test(`${before}${after}`)) {
      return ymd;
    }
  }
  return undefined;
}

export function extractLaborCalcFill(instruction: string): LaborCalcFill {
  const gaps: string[] = [];
  const yearsOfService = parseYears(instruction);
  const monthlyWageYuan = parseWageYuan(instruction);
  const kind = parseKind(instruction);
  const overtimeSlots = parseOvertime(instruction);
  if (!yearsOfService) {
    gaps.push("工龄（年）");
  }
  if (!monthlyWageYuan) {
    gaps.push("月工资");
  }
  const fill: LaborCalcFill = {
    kind,
    yearsOfService,
    monthlyWageYuan,
    overtimeHours: overtimeSlots?.hours,
    overtimeKind: overtimeSlots?.kind,
    gaps,
  };
  if (kind && yearsOfService && monthlyWageYuan) {
    fill.compensation = computeEconomicCompensation({
      yearsOfService,
      monthlyWageYuan,
      kind,
    });
  }
  if (overtimeSlots && monthlyWageYuan) {
    fill.overtime = computeOvertimePay({
      kind: overtimeSlots.kind,
      hours: overtimeSlots.hours,
      monthlyWageYuan,
    });
  } else if (overtimeSlots && !monthlyWageYuan) {
    gaps.push("加班费缺月工资");
  }
  const arbitrationStart = parseArbitrationStart(instruction);
  if (arbitrationStart) {
    const computed = computeLegalPeriod("labor_arbitration_apply", arbitrationStart);
    if ("expires" in computed) {
      fill.arbitration = computed;
    } else {
      gaps.push(computed.error);
    }
  } else {
    gaps.push("仲裁时效起算日（解除/知道侵害之日）");
  }
  return fill;
}

export function formatLaborArbitrationBody(fill: LaborCalcFill): string {
  if (fill.arbitration) {
    return [
      `劳动争议一般先仲裁。申请仲裁时效起算：${fill.arbitration.start}。`,
      `届满日：${fill.arbitration.expires}。公式：${fill.arbitration.formula}。`,
      "不属于仲裁前置的请求单独标明。中断、中止、节假日顺延不在本引擎内自动处理。",
    ].join("\n");
  }
  return "劳动争议一般先仲裁。仲裁时效起算日：【待补充】解除或知道权利被侵害之日。缺日起不算届满日。不属于仲裁前置的请求单独标明。";
}

export function formatLaborCalcBody(fill: LaborCalcFill): string {
  const lines: string[] = ["须用规则引擎数字，禁止口算交差。"];
  if (fill.compensation) {
    lines.push(
      `已算清经济补偿（${fill.compensation.kind}）：${fill.compensation.amountYuan} 元。公式：${fill.compensation.formula}。`,
    );
    if (fill.compensation.notes.length > 0) {
      lines.push(...fill.compensation.notes.map((n) => `- ${n}`));
    }
  } else {
    lines.push(
      `经济补偿：工龄 ${fill.yearsOfService ?? "【待补充】"} 年，月工资 ${fill.monthlyWageYuan ?? "【待补充】"} 元，种类 ${fill.kind ?? "【待补充】"}。缺槽未代算。`,
    );
  }
  if (fill.overtime) {
    lines.push(
      `已算清加班费（${fill.overtime.kind}）：${fill.overtime.amountYuan} 元。公式：${fill.overtime.formula}。`,
    );
  }
  if (fill.gaps.length > 0) {
    lines.push(`待补后才能定：${fill.gaps.join("、")}。缺槽仍交付已算清的段。`);
  }
  return lines.join("\n");
}
