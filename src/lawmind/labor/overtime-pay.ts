/**
 * PRC overtime multipliers. Hourly wage uses 月工资 ÷ 21.75 ÷ 8 unless overridden.
 */

export type OvertimeKind = "weekday" | "rest_day" | "statutory_holiday";

export type OvertimePayInput = {
  kind: OvertimeKind;
  hours: number;
  monthlyWageYuan: number;
  workdaysPerMonth?: number;
  hoursPerDay?: number;
};

export type OvertimePayResult = {
  kind: OvertimeKind;
  hourlyWageYuan: number;
  multiplier: number;
  amountYuan: number;
  formula: string;
  notes: string[];
};

const MULTIPLIER: Record<OvertimeKind, number> = {
  weekday: 1.5,
  rest_day: 2,
  statutory_holiday: 3,
};

function roundYuan(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeOvertimePay(input: OvertimePayInput): OvertimePayResult {
  const notes: string[] = [];
  const workdays = input.workdaysPerMonth ?? 21.75;
  const hoursPerDay = input.hoursPerDay ?? 8;
  const hourly = input.monthlyWageYuan / workdays / hoursPerDay;
  const multiplier = MULTIPLIER[input.kind];
  const amountYuan = roundYuan(hourly * input.hours * multiplier);
  if (input.kind === "rest_day") {
    notes.push("休息日加班按 200%；已依法安排补休的，不要再叠加班费。");
  }
  if (input.kind === "weekday") {
    notes.push("工作日延长工时 150%。");
  }
  if (input.kind === "statutory_holiday") {
    notes.push("法定节假日 300%，不因补休免除。");
  }
  return {
    kind: input.kind,
    hourlyWageYuan: roundYuan(hourly),
    multiplier,
    amountYuan,
    formula: `${roundYuan(hourly)} × ${input.hours} × ${multiplier}`,
    notes,
  };
}
