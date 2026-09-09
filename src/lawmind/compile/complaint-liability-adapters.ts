/**
 * Adapters: complaint + liability-cap → CompileFillIR.
 */

import {
  extractComplaintFillPlan,
  type ComplaintFillPlan,
} from "../litigation/complaint-fill-plan.js";
import { extractLiabilityCapFill, type LiabilityCapFill } from "../practice/liability-cap.js";
import type { CompileFillIR } from "./compile-fill.js";
import { collectGaps } from "./compile-fill.js";

function isPlaceholder(value: string): boolean {
  return value.trim().startsWith("【");
}

export function complaintToFill(plan: ComplaintFillPlan): CompileFillIR {
  const slots = [
    {
      key: "court",
      label: "受诉法院",
      value: isPlaceholder(plan.court) ? undefined : plan.court,
      gap: isPlaceholder(plan.court) ? "人民法院名称" : undefined,
    },
    {
      key: "plaintiffs",
      label: "原告",
      value: isPlaceholder(plan.plaintiffs) ? undefined : plan.plaintiffs,
      gap: isPlaceholder(plan.plaintiffs) ? "原告" : undefined,
    },
    {
      key: "defendants",
      label: "被告",
      value: isPlaceholder(plan.defendants) ? undefined : plan.defendants,
      gap: isPlaceholder(plan.defendants) ? "被告" : undefined,
    },
    {
      key: "claims",
      label: "诉讼请求",
      value: plan.claims.filter((c) => !isPlaceholder(c)).join("；") || undefined,
      gap: plan.claims.every((c) => isPlaceholder(c)) ? "诉讼请求" : undefined,
    },
  ];
  return {
    kind: "litigation.complaint",
    slots,
    gaps: collectGaps(slots),
    computed: plan,
  };
}

export function liabilityCapToFill(fill: LiabilityCapFill): CompileFillIR {
  const slots = [
    { key: "directCap", label: "直接损失上限", value: fill.directCap },
    { key: "consequential", label: "间接/可得利益", value: fill.consequential },
    { key: "carveOuts", label: "carve-out", value: fill.carveOuts },
    { key: "base", label: "基数定义", value: fill.base },
    { key: "breakDeal", label: "破局条款", value: fill.breakDeal },
    {
      key: "neverHits",
      label: "永不接受命中",
      value: fill.neverHits.length > 0 ? fill.neverHits.join("、") : undefined,
    },
  ];
  return {
    kind: "liability.cap",
    slots,
    gaps: [],
    computed: fill,
  };
}

export function extractComplaintCompileFill(instruction: string): CompileFillIR {
  return complaintToFill(extractComplaintFillPlan(instruction));
}

export function extractLiabilityCapCompileFill(instruction: string): CompileFillIR {
  return liabilityCapToFill(extractLiabilityCapFill(instruction));
}
