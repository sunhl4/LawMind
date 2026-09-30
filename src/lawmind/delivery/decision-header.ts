import type { LegalLintReport } from "../lint/types.js";
import type { DeliveryRiskLevel, JudgmentCoverageSummary } from "./types.js";
import { isDecisionHeader, type DecisionHeader, type SelfReviseSummary } from "./types.js";

export type BuildDecisionHeaderInput = {
  title: string;
  lint: Pick<LegalLintReport, "blockerCount" | "warningCount" | "summaryZh"> & {
    findings?: Array<{ severity?: string; message?: string }>;
    /** 规则崩溃记 skipped，与「核对通过」区分。 */
    failedRules?: string[];
  };
  selfRevise?: SelfReviseSummary | null;
  riskLevel?: DeliveryRiskLevel;
  /** G3：判定主体覆盖（不传即不写该字段，不编 0）。 */
  judgmentCoverage?: JudgmentCoverageSummary;
  /** E7：未能核验信号；不传则不写第五段。 */
  unverified?: UnverifiedSignals | null;
};

/**
 * 未能核验信号三态（对齐 reasoning skippedChecks / Guardian present）：
 * - skipped：有意图核对但跳过了
 * - pending：知道没核完（待定夺、无快照等）
 * - unread：读失败，不得冒充「没有」
 */
export type UnverifiedSignals = {
  skipped?: string[];
  pending?: string[];
  unread?: string[];
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

function cleanParts(list: string[] | undefined): string[] {
  return (list ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * 律师面第五段。无信号 → `undefined`（真的没有）；有 unread → 必须说「读不到」。
 */
export function formatUnverifiedSection(
  signals: UnverifiedSignals | null | undefined,
): string | undefined {
  if (!signals) {
    return undefined;
  }
  const unread = cleanParts(signals.unread);
  const skipped = cleanParts(signals.skipped);
  const pending = cleanParts(signals.pending);
  if (unread.length === 0 && skipped.length === 0 && pending.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (unread.length > 0) {
    parts.push(
      `有 ${unread.length} 处读不到（${unread.slice(0, 3).join("、")}${unread.length > 3 ? "…" : ""}）`,
    );
  }
  if (skipped.length > 0) {
    parts.push(
      `有 ${skipped.length} 处未核完（${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? "…" : ""}）`,
    );
  }
  if (pending.length > 0) {
    parts.push(`还有待决：${pending.slice(0, 4).join("；")}${pending.length > 4 ? "…" : ""}`);
  }
  return `${parts.join("。")}。`;
}

/** 从改稿台手头信号拼装 UnverifiedSignals（不编造 0）。 */
export function collectUnverifiedSignals(input: {
  lint?: BuildDecisionHeaderInput["lint"] | null;
  reasoningSkippedChecks?: string[] | null;
  citation?: { checked: boolean; reason?: string; ok?: boolean } | null;
  guardian?: { verdict?: string; skipReason?: string; gaps?: unknown[] } | null;
  guardianUnread?: boolean;
}): UnverifiedSignals | undefined {
  const skipped: string[] = [];
  const pending: string[] = [];
  const unread: string[] = [];

  const failed = input.lint?.failedRules ?? [];
  for (const rule of failed) {
    const id = rule.trim();
    if (id) {
      skipped.push(`机械核对规则 ${id}`);
    }
  }

  for (const check of input.reasoningSkippedChecks ?? []) {
    const id = check.trim();
    if (!id) {
      continue;
    }
    if (id === "structure:*") {
      skipped.push("论证结构（无推理图）");
    } else if (id === "authorities_cited_in_body") {
      skipped.push("正文权威引用核对");
    } else {
      skipped.push(id);
    }
  }

  const citation = input.citation;
  if (citation && !citation.checked) {
    pending.push("引用未核（无检索快照）");
  } else if (citation && citation.checked && citation.ok === false) {
    pending.push("引用完整性未通过");
  }

  if (input.guardianUnread) {
    unread.push("独立审稿结果");
  } else if (input.guardian?.verdict === "skipped") {
    const reason = input.guardian.skipReason?.trim();
    skipped.push(reason ? `独立审稿：${reason}` : "独立审稿未跑完");
  }

  if (skipped.length === 0 && pending.length === 0 && unread.length === 0) {
    return undefined;
  }
  return {
    ...(skipped.length ? { skipped } : {}),
    ...(pending.length ? { pending } : {}),
    ...(unread.length ? { unread } : {}),
  };
}

/**
 * Lawyer-facing decision header: 改了什么 / 为什么 / 风险 / 未能核验 / 可直接用或需定夺.
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

  const unverified = formatUnverifiedSection(input.unverified ?? undefined);

  return {
    changed: changedLine(input.title, input.selfRevise),
    why: whyLine(input.selfRevise),
    risk: riskLine(input.lint, input.riskLevel),
    ready: needsDecision ? "needs_decision" : "usable",
    ...(input.judgmentCoverage ? { judgmentCoverage: input.judgmentCoverage } : {}),
    ...(unverified ? { unverified } : {}),
  };
}

/**
 * G3：覆盖自述（律师可读）。
 *
 * 说清「本次核对了多少、其中多少由机器判、多少需您定夺」，**不出现任何"正确率"**。
 * 这是 `lint/types.ts` 那条口径的 UI 面：*Passing lint ≠ legally correct*。
 *
 * 全零时返回 `undefined`——没有核对项不等于"核对了 0 项"。
 */
export function formatJudgmentCoverage(
  coverage: JudgmentCoverageSummary | undefined,
): string | undefined {
  if (!coverage) {
    return undefined;
  }
  const total = coverage.machine + coverage.judged + coverage.escalated;
  if (total === 0) {
    return undefined;
  }
  const parts = [`本次核对 ${total} 项`];
  if (coverage.machine > 0) {
    parts.push(`${coverage.machine} 项由确定性规则判定`);
  }
  if (coverage.escalated > 0) {
    parts.push(`${coverage.escalated} 项待您定夺`);
  }
  parts.push("通过核对 ≠ 法律正确");
  return `${parts.join("，")}。`;
}

/**
 * Prefer a persisted draft header for the four core lines; always overlay
 * live `unverified` / `judgmentCoverage` so改稿台第五段不会被旧四段头吃掉。
 */
export function resolveDecisionHeader(input: {
  persisted?: unknown;
  title: string;
  lint: BuildDecisionHeaderInput["lint"];
  selfRevise?: SelfReviseSummary | null;
  riskLevel?: DeliveryRiskLevel;
  judgmentCoverage?: JudgmentCoverageSummary;
  unverified?: UnverifiedSignals | null;
}): DecisionHeader {
  const built = buildDecisionHeader(input);
  if (!isDecisionHeader(input.persisted)) {
    return built;
  }
  const base = input.persisted;
  const next: DecisionHeader = { ...base };
  if (built.unverified) {
    next.unverified = built.unverified;
  } else {
    delete next.unverified;
  }
  if (input.judgmentCoverage) {
    next.judgmentCoverage = input.judgmentCoverage;
  }
  return next;
}

export { isDecisionHeader };
export type { DecisionHeader, SelfReviseSummary };
