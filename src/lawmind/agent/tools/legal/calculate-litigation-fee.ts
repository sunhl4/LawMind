/**
 * `calculate` 的 litigation_fee 分派：诉讼费/保全费/执行申请费核算。
 *
 * 独立成模块的原因（不是为拆而拆）：
 *   - `calculate-lib.ts` 是 op 分派器，已接近 600 行软上限；
 *     `scripts/pre-commit/check-file-size.mjs` 要求「先拆再放行」，不往基线里加。
 *   - 该分派依赖 `litigation/*` 的两块领域逻辑（费率表 + 金额解析），
 *     与 lib 里其它 op（利息、劳动）无耦合，适合独立成文件。
 *
 * 口径与 `src/lawmind/litigation/litigation-fee.ts` 一致：只做确定性算术，
 * 幅度类只给区间、不代选具体值；金额解析歧义时诚实失败。
 */

import { parseClaimAmount } from "../../../litigation/claim-amount.js";
import {
  LITIGATION_CASE_KIND_LABELS,
  LITIGATION_FEE_EFFECTIVE_FROM,
  LITIGATION_FEE_SOURCE,
  applyAcceptanceReductions,
  computeAcceptanceFeeForKind,
  computeExecutionFee,
  computePreservationFee,
  type LitigationCaseKind,
} from "../../../litigation/litigation-fee.js";

export type LitigationFeeOpResult = {
  ok: true;
  value: number;
  formula: string;
  inputs: Record<string, unknown>;
  notes: string;
};
export type LitigationFeeOpError = { ok: false; error: string };

/** 与 `calculate-lib.ts` 的 asNum 同口径（该助手未导出，此处保持同样报错文案）。 */
function asFiniteNum(value: unknown, name: string): number | { error: string } {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { error: `${name} 必须是数字。` };
  }
  return n;
}

function isError(v: number | { error: string }): v is { error: string } {
  return typeof v !== "number";
}

export function computeLitigationFeeOp(
  inputs: Record<string, unknown>,
): LitigationFeeOpResult | LitigationFeeOpError {
  const kindRaw = typeof inputs.caseKind === "string" ? inputs.caseKind.trim() : "property";
  if (!(kindRaw in LITIGATION_CASE_KIND_LABELS)) {
    return {
      ok: false,
      error: `caseKind 必须是：${Object.keys(LITIGATION_CASE_KIND_LABELS).join(" / ")}。`,
    };
  }
  const kind = kindRaw as LitigationCaseKind;

  // 金额可传数值，也可传卷宗里的自由文本（如「3.21万元」）。
  let claimAmountYuan: number | undefined;
  if (inputs.amountText != null) {
    const parsed = parseClaimAmount(typeof inputs.amountText === "string" ? inputs.amountText : "");
    if (!parsed.ok) {
      return { ok: false, error: parsed.reason };
    }
    claimAmountYuan = parsed.yuan;
  } else if (inputs.amountYuan != null) {
    const n = asFiniteNum(inputs.amountYuan, "amountYuan");
    if (isError(n)) {
      return { ok: false, error: n.error };
    }
    claimAmountYuan = n;
  }

  const maritalPropertyYuan =
    inputs.maritalPropertyYuan != null ? Number(inputs.maritalPropertyYuan) : undefined;
  const damagesYuan = inputs.damagesYuan != null ? Number(inputs.damagesYuan) : undefined;
  const computed = computeAcceptanceFeeForKind(kind, {
    claimAmountYuan,
    maritalPropertyYuan,
    damagesYuan,
  });

  const simplified = inputs.simplified === true;
  const mediationOrWithdrawal = inputs.mediationOrWithdrawal === true;
  const reductions =
    computed.kind === "exact"
      ? applyAcceptanceReductions(computed, { simplified, mediationOrWithdrawal })
      : [];

  // 保全/执行是「申请费」，与受理费并列，可一并核算。
  const withPreservation =
    inputs.preservedAmountYuan != null
      ? computePreservationFee(Number(inputs.preservedAmountYuan))
      : undefined;
  const withExecution =
    inputs.executionAmountYuan != null
      ? computeExecutionFee(Number(inputs.executionAmountYuan))
      : undefined;

  const total =
    (computed.kind === "exact" ? computed.amountYuan : computed.minYuan) +
    (withPreservation?.amountYuan ?? 0) +
    (withExecution?.amountYuan ?? 0);

  return {
    ok: true,
    value: total,
    formula:
      computed.kind === "exact"
        ? computed.formula
        : `${computed.minYuan}–${computed.maxYuan} 元（幅度）`,
    inputs: {
      caseKind: kind,
      claimAmountYuan,
      preservedAmountYuan: inputs.preservedAmountYuan ?? undefined,
      executionAmountYuan: inputs.executionAmountYuan ?? undefined,
    },
    notes: [
      `${LITIGATION_FEE_SOURCE}（${LITIGATION_FEE_EFFECTIVE_FROM} 施行）。`,
      computed.kind === "range" ? computed.note : undefined,
      reductions.length > 0
        ? `减半口径：${reductions.map((r) => `${r.reason} → ${r.amountYuan} 元（${r.source}）`).join("；")}。`
        : undefined,
      withPreservation
        ? `保全申请费 ${withPreservation.amountYuan} 元${withPreservation.capped ? "（已达 5000 元上限）" : ""}；保全费不因简易程序减半。`
        : undefined,
      withExecution ? `执行申请费 ${withExecution.amountYuan} 元。` : undefined,
      "幅度类收费由省级政府在法定幅度内定标准，本工具不代选具体值。",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
