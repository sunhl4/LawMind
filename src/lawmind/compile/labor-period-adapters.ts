/**
 * Adapters: existing labor/period fills → CompileFillIR.
 */

import { extractLaborCalcFill, type LaborCalcFill } from "../labor/labor-calc-fill.js";
import { extractPeriodCalcFill, type PeriodCalcFill } from "../labor/period-calc-fill.js";
import type { CompileFillIR } from "./compile-fill.js";

export function laborCalcToFill(fill: LaborCalcFill): CompileFillIR {
  const slots = [
    {
      key: "kind",
      label: "补偿种类",
      value: fill.kind,
      gap: fill.kind ? undefined : "补偿种类",
    },
    {
      key: "years",
      label: "工龄（年）",
      value: fill.yearsOfService !== undefined ? String(fill.yearsOfService) : undefined,
      gap: fill.yearsOfService !== undefined ? undefined : "工龄（年）",
    },
    {
      key: "wage",
      label: "月工资",
      value: fill.monthlyWageYuan !== undefined ? String(fill.monthlyWageYuan) : undefined,
      gap: fill.monthlyWageYuan !== undefined ? undefined : "月工资",
    },
    {
      key: "amount",
      label: "已算清金额",
      value: fill.compensation !== undefined ? String(fill.compensation.amountYuan) : undefined,
      gap: fill.compensation ? undefined : "金额（缺槽未代算）",
    },
  ];
  return {
    kind: "labor.calc",
    slots,
    gaps: fill.gaps,
    computed: fill,
  };
}

export function periodCalcToFill(fill: PeriodCalcFill): CompileFillIR {
  const slots = [
    {
      key: "kind",
      label: "期间种类",
      value: fill.kind,
      gap: fill.kind ? undefined : "期间种类",
    },
    {
      key: "start",
      label: "起算日",
      value: fill.start,
      gap: fill.start ? undefined : "起算日（须到日）",
    },
    {
      key: "expires",
      label: "届满日",
      value: fill.result?.expires,
      gap: fill.result ? undefined : "届满日（缺槽未代算）",
    },
  ];
  return {
    kind: "period.calc",
    slots,
    gaps: fill.gaps,
    computed: fill,
  };
}

export function extractLaborCompileFill(instruction: string): CompileFillIR {
  return laborCalcToFill(extractLaborCalcFill(instruction));
}

export function extractPeriodCompileFill(instruction: string): CompileFillIR {
  return periodCalcToFill(extractPeriodCalcFill(instruction));
}
