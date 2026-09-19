/**
 * Export lint gate (「法律版 tsc」): outbound deliverables must pass the
 * mechanical lint package before a Word/PPT file is written.
 *
 * Scope discipline (GOALS 非目标): only mechanical residual blockers flip the
 * result. Warnings and judgment-class findings (statutory caps, forum choice,
 * stance) never block export — they stay in the lint report for the lawyer.
 */

import type { LegalLintCitationHit } from "./citation-validity.js";
import { draftTextFromUnknown, runLegalLint } from "./run-lint.js";
import { classifyResidual } from "./self-revise.js";
import type { LegalLintReport } from "./types.js";

/** Outbound deliverable types gated by the mechanical lint package. */
const EXPORT_LINT_GATE_EXACT = new Set(["memo.opinion", "memo.research", "contract.review"]);
const EXPORT_LINT_GATE_PREFIXES = ["letter.", "litigation."];

export function deliverableNeedsExportLint(deliverableType: string | undefined): boolean {
  if (!deliverableType) {
    return false;
  }
  if (EXPORT_LINT_GATE_EXACT.has(deliverableType)) {
    return true;
  }
  return EXPORT_LINT_GATE_PREFIXES.some((prefix) => deliverableType.startsWith(prefix));
}

export type ExportLintGateResult = {
  ok: boolean;
  lintReport: LegalLintReport;
  /** Mechanical residual blocker rule ids (empty when ok). */
  blockerRuleIds: string[];
  error?: string;
};

/**
 * Run the mechanical lint package for an outbound deliverable. `citationHits`
 * carries optional live statute-status rows (e.g. NPC FLK) so citation
 * validity findings reflect 现行有效/已废止 instead of offline-only markers.
 */
export function runExportLintGate(input: {
  text: string;
  deliverableType?: string;
  citationHits?: LegalLintCitationHit[];
}): ExportLintGateResult {
  const lintReport = runLegalLint(
    input.text,
    input.citationHits && input.citationHits.length > 0 ? input.citationHits : undefined,
    undefined,
    undefined,
    { deliverableType: input.deliverableType },
  );
  const { residualMechanical } = classifyResidual(lintReport.findings);
  const blockers = residualMechanical.filter((f) => f.severity === "blocker");
  if (blockers.length === 0) {
    return { ok: true, lintReport, blockerRuleIds: [] };
  }
  const blockerRuleIds = blockers.map((f) => f.ruleId);
  const detail = blockers
    .slice(0, 4)
    .map((f) => `「${f.message}」`)
    .join("；");
  return {
    ok: false,
    lintReport,
    blockerRuleIds,
    error:
      `导出前机械核对未过（${blockerRuleIds.slice(0, 4).join("、")}）：${detail}。` +
      "请收窄到指出的条款改稿后重试导出；法定参数/或裁或诉等需律师判断项不会被本门禁拦截，可在文中说明理由。",
  };
}

/** Convenience: gate a persisted draft-shaped object. */
export function runExportLintGateForDraft(input: {
  draft: unknown;
  deliverableType?: string;
  citationHits?: LegalLintCitationHit[];
}): ExportLintGateResult {
  return runExportLintGate({
    text: draftTextFromUnknown(input.draft),
    deliverableType: input.deliverableType,
    citationHits: input.citationHits,
  });
}
