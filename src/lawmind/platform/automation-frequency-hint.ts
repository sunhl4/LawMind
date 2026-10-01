/**
 * Interval frequency copy for the settings UI.
 * Browser-safe: no node imports. The automation ledger lives in lawyer-automations.ts.
 */

/** Min/max for interval schedules (minutes). */
export const AUTOMATION_INTERVAL_MIN_MINUTES = 5;
export const AUTOMATION_INTERVAL_MAX_MINUTES = 7 * 24 * 60;

export function clampEveryMinutes(n: number): number {
  if (!Number.isFinite(n)) {
    return 30;
  }
  return Math.min(
    AUTOMATION_INTERVAL_MAX_MINUTES,
    Math.max(AUTOMATION_INTERVAL_MIN_MINUTES, Math.floor(n)),
  );
}

/**
 * interval 排期一天大约跑几次（向下取整）。
 * 只做频次可见性，不编造 ¥ / token 单价。
 */
export function estimateIntervalRunsPerDay(everyMinutes: number): number {
  const mins = clampEveryMinutes(everyMinutes);
  return Math.max(1, Math.floor((24 * 60) / mins));
}

/** 创建/编辑 interval 时常设工作的频次 × 成本提示（定性，无假定价）。 */
export function formatAutomationFrequencyCostHint(schedule: {
  kind: string;
  everyMinutes?: number;
}): string | null {
  if (schedule.kind !== "interval") {
    return null;
  }
  const n = estimateIntervalRunsPerDay(schedule.everyMinutes ?? Number.NaN);
  return `约 ${n} 次/天。每次运行都会消耗模型用量；没有新情况也可能空跑。`;
}
