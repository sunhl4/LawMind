import type { LegalLintReport } from "../lint/types.js";
import type { DeliveryRiskLevel } from "./types.js";
import { isDecisionHeader, type DecisionHeader, type SelfReviseSummary } from "./types.js";

export type BuildDecisionHeaderInput = {
  title: string;
  lint: Pick<LegalLintReport, "blockerCount" | "warningCount" | "summaryZh"> & {
    findings?: Array<{ severity?: string; message?: string }>;
  };
  selfRevise?: SelfReviseSummary | null;
  riskLevel?: DeliveryRiskLevel;
};

function titleLabel(title: string): string {
  const t = title.trim();
  return t ? `「${t}」` : "本轮草稿";
}

function changedLine(title: string, selfRevise?: SelfReviseSummary | null): string {
  const applied = selfRevise?.appliedSummaries?.map((s) => s.trim()).filter(Boolean) ?? [];
  const appliedCount = selfRevise?.appliedCount ?? applied.length;
  if (applied.length > 0) {
    const shown = applied.slice(0, 3).join("、");
    const extra = applied.length > 3 ? `等 ${applied.length} 处` : "";
    return `已按机械核对修订：${shown}${extra}。`;
  }
  if (appliedCount > 0) {
    const rounds =
      typeof selfRevise?.rounds === "number" && selfRevise.rounds > 0
        ? `（${selfRevise.rounds} 轮）`
        : "";
    return `已自动修订 ${appliedCount} 处机械项${rounds}。`;
  }
  return `起草了${titleLabel(title)}，待您审阅。`;
}

function whyLine(selfRevise?: SelfReviseSummary | null): string {
  const appliedCount =
    selfRevise?.appliedCount ?? selfRevise?.appliedSummaries?.filter((s) => s.trim()).length ?? 0;
  if (appliedCount > 0) {
    return "消除机械核对中可自动修复的问题。主观裁量未代为决定。";
  }
  return "按任务要求整理草稿，便于您审阅后交付。";
}

function riskLine(lint: BuildDecisionHeaderInput["lint"], riskLevel?: DeliveryRiskLevel): string {
  const honest = "通过核对 ≠ 法律正确。";
  if (lint.blockerCount > 0) {
    return `机械核对仍有 ${lint.blockerCount} 项须处理。${honest}`;
  }
  if (riskLevel === "high") {
    return `高风险稿，须通篇复核。${honest}`;
  }
  if (riskLevel === "medium") {
    return `中风险，签批前请通读。${honest}`;
  }
  if (lint.warningCount > 0) {
    return `机械核对有 ${lint.warningCount} 项提示。${honest}`;
  }
  return `机械核对未见已知缺陷。${honest}`;
}

/**
 * Lawyer-facing decision header: 改了什么 / 为什么 / 风险 / 可直接用或需定夺.
 * Honest when lint still has blockers.
 */
export function buildDecisionHeader(input: BuildDecisionHeaderInput): DecisionHeader {
  const residualCount =
    input.selfRevise?.residualCount ??
    input.selfRevise?.residualSummaries?.filter((s) => s.trim()).length ??
    0;
  const needsDecision =
    input.lint.blockerCount > 0 ||
    residualCount > 0 ||
    input.riskLevel === "high" ||
    input.riskLevel === "medium";

  return {
    changed: changedLine(input.title, input.selfRevise),
    why: whyLine(input.selfRevise),
    risk: riskLine(input.lint, input.riskLevel),
    ready: needsDecision ? "needs_decision" : "usable",
  };
}

/** Prefer a persisted draft header; otherwise derive from title + lint. */
export function resolveDecisionHeader(input: {
  persisted?: unknown;
  title: string;
  lint: BuildDecisionHeaderInput["lint"];
  selfRevise?: SelfReviseSummary | null;
  riskLevel?: DeliveryRiskLevel;
}): DecisionHeader {
  if (isDecisionHeader(input.persisted)) {
    return input.persisted;
  }
  return buildDecisionHeader(input);
}

export { isDecisionHeader };
export type { DecisionHeader, SelfReviseSummary };
