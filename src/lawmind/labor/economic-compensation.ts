/**
 * PRC labor-contract economic compensation (simplified, for slot-fill + formula).
 * 不满六个月按半个月；六个月以上不满一年按一年。高工资封顶由调用方传入。
 */

export type EconomicCompensationKind = "N" | "N+1" | "2N";

export type EconomicCompensationInput = {
  /** 工作年限（年）。0.5 = 不满六个月按半个月。 */
  yearsOfService: number;
  monthlyWageYuan: number;
  /** 当地职工月平均工资；缺省不封顶。 */
  localAverageWageYuan?: number;
  kind: EconomicCompensationKind;
};

export type EconomicCompensationResult = {
  kind: EconomicCompensationKind;
  nMonths: number;
  cappedWageYuan: number;
  amountYuan: number;
  formula: string;
  notes: string[];
};

function roundYuan(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 劳动合同法第47条月数：每满一年一个月；六个月以上不满一年按一年；不满六个月半个月。 */
export function compensationMonthsFromYears(yearsOfService: number): number {
  if (!Number.isFinite(yearsOfService) || yearsOfService <= 0) {
    return 0;
  }
  const whole = Math.floor(yearsOfService);
  const frac = yearsOfService - whole;
  if (frac < 0.5) {
    return whole + (frac > 0 ? 0.5 : 0);
  }
  return whole + 1;
}

export function computeEconomicCompensation(
  input: EconomicCompensationInput,
): EconomicCompensationResult {
  const notes: string[] = [];
  let nMonths = compensationMonthsFromYears(input.yearsOfService);
  let cappedWage = input.monthlyWageYuan;
  const avg = input.localAverageWageYuan;
  if (avg && avg > 0 && input.monthlyWageYuan > avg * 3) {
    cappedWage = avg * 3;
    nMonths = Math.min(nMonths, 12);
    notes.push("月工资高于当地社平三倍：按三倍计，年限最高十二年。");
  }
  if (input.kind === "2N") {
    notes.push("按违法解除：经济补偿的二倍。");
  }
  if (input.kind === "N+1") {
    notes.push("另加一个月工资作为代通知金。");
  }
  const multiplier = input.kind === "2N" ? 2 : 1;
  const extra = input.kind === "N+1" ? 1 : 0;
  const amountYuan = roundYuan(cappedWage * (nMonths * multiplier + extra));
  const formula =
    input.kind === "N+1"
      ? `${roundYuan(cappedWage)} × (${nMonths} + 1)`
      : input.kind === "2N"
        ? `${roundYuan(cappedWage)} × ${nMonths} × 2`
        : `${roundYuan(cappedWage)} × ${nMonths}`;
  return {
    kind: input.kind,
    nMonths,
    cappedWageYuan: roundYuan(cappedWage),
    amountYuan,
    formula,
    notes,
  };
}
