/**
 * Deterministic PRC procedure periods. Start date is the triggering date (送达日等);
 * 期间开始的日不计入，届满日 = 起算日 + 法定日数/年数。
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export const LEGAL_PERIOD_KINDS = [
  "civil_appeal",
  "civil_answer",
  "labor_award_sue",
  "labor_arbitration_apply",
  "civil_retrial",
  "execution",
] as const;

export type LegalPeriodKind = (typeof LEGAL_PERIOD_KINDS)[number];

export type LegalPeriodResult = {
  kind: LegalPeriodKind;
  start: string;
  expires: string;
  formula: string;
  notes: string[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseYmd(raw: string): { y: number; m: number; d: number } | undefined {
  const m = YMD.exec(raw.trim());
  if (!m) {
    return undefined;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return { y, m: mo, d };
}

export function addCalendarDays(start: string, days: number): string | undefined {
  const p = parseYmd(start);
  if (!p || !Number.isInteger(days)) {
    return undefined;
  }
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addCalendarMonths(start: string, months: number): string | undefined {
  const p = parseYmd(start);
  if (!p || !Number.isInteger(months) || months < 0) {
    return undefined;
  }
  const dt = new Date(Date.UTC(p.y, p.m - 1 + months, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const d = Math.min(p.d, last);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(d)}`;
}

function addCalendarYears(start: string, years: number): string | undefined {
  const p = parseYmd(start);
  if (!p) {
    return undefined;
  }
  const y = p.y + years;
  const last = new Date(Date.UTC(y, p.m, 0)).getUTCDate();
  const d = Math.min(p.d, last);
  return `${y}-${pad2(p.m)}-${pad2(d)}`;
}

const KIND_NOTE: Record<LegalPeriodKind, string> = {
  civil_appeal: "民事判决送达之次日起十五日（民事诉讼法上诉期）。节假日顺延由律师判断。",
  civil_answer: "民事起诉状副本送达之次日起十五日答辩期。",
  labor_award_sue: "劳动仲裁裁决书送达之次日起十五日内向法院起诉。",
  labor_arbitration_apply: "劳动争议申请仲裁时效一年，从知道或应当知道权利被侵害之日起算。",
  civil_retrial: "判决生效后六个月申请再审的常见期间；特殊事由另计。",
  execution: "申请执行期间二年，从法律文书规定履行期间的最后一日起算。",
};

export function isLegalPeriodKind(value: string): value is LegalPeriodKind {
  return (LEGAL_PERIOD_KINDS as readonly string[]).includes(value);
}

export function computeLegalPeriod(
  kind: LegalPeriodKind,
  start: string,
): LegalPeriodResult | { error: string } {
  if (!parseYmd(start)) {
    return { error: "start 必须是 YYYY-MM-DD。" };
  }
  let expires: string | undefined;
  let formula: string;
  if (kind === "civil_appeal" || kind === "civil_answer" || kind === "labor_award_sue") {
    expires = addCalendarDays(start, 15);
    formula = `${start} + 15 日`;
  } else if (kind === "labor_arbitration_apply") {
    expires = addCalendarYears(start, 1);
    formula = `${start} + 1 年`;
  } else if (kind === "civil_retrial") {
    expires = addCalendarMonths(start, 6);
    formula = `${start} + 6 个月`;
  } else {
    expires = addCalendarYears(start, 2);
    formula = `${start} + 2 年`;
  }
  if (!expires) {
    return { error: "无法计算届满日。" };
  }
  return {
    kind,
    start,
    expires,
    formula,
    notes: [KIND_NOTE[kind], "中断、中止、节假日顺延不在本引擎内自动处理。"],
  };
}
