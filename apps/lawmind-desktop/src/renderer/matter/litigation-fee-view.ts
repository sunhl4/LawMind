/**
 * 工作台「案件信息」里的诉讼费展示口径（纯函数，便于测试）。
 *
 * 用词守则：
 *   - 只说「估算」，并写明出处——诉讼费最终以法院核定为准；
 *   - 幅度类收费（离婚/人格权等）不代选具体值；
 *   - 金额解析不出或有多义时显示原因，不猜。
 */

import { parseClaimAmount } from "../../../../../src/lawmind/litigation/claim-amount.ts";
import {
  LITIGATION_FEE_SOURCE,
  computeCaseAcceptanceFee,
  formatFeeYuan,
} from "../../../../../src/lawmind/litigation/litigation-fee.ts";

export type FeeEstimateView = {
  /** 主值，如「13,800 元」；无法估算时为「—」。 */
  value: string;
  /** 辅助说明（含减半对照与出处）。 */
  hint?: string;
  /** 是否成功估算。 */
  ok: boolean;
};

/**
 * 按标的金额估算财产案件受理费（工作台常用口径）。
 * 传入的是卷宗里的自由文本 `docket.claimAmount`。
 */
export function acceptanceFeeView(claimAmount: string | undefined): FeeEstimateView {
  const raw = (claimAmount ?? "").trim();
  if (!raw) {
    return { value: "—", ok: false, hint: "填写标的金额后自动估算。" };
  }
  const parsed = parseClaimAmount(raw);
  if (!parsed.ok) {
    return { value: "—", ok: false, hint: parsed.reason };
  }
  const fee = computeCaseAcceptanceFee(parsed.yuan);
  const half = Math.round((fee.amountYuan / 2) * 100) / 100;
  return {
    value: formatFeeYuan(fee.amountYuan),
    ok: true,
    hint:
      `按财产案件受理费估算（${LITIGATION_FEE_SOURCE}第十三条）。` +
      `适用简易程序或调解结案/撤诉减半为 ${formatFeeYuan(half)}。` +
      `保全申请费另计（上限 5000 元）；最终以法院核定为准。`,
  };
}
