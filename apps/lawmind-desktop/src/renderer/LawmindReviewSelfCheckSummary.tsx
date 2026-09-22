/**
 * 审核台首屏：交卷核对（机械门禁、独立审稿、引用），不是写者自评。
 */

import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { SelfReviseResult } from "../../../../src/lawmind/lint/self-revise.ts";
import type { LegalLintReport } from "../../../../src/lawmind/lint/types.ts";
import type { GuardianLawyerView } from "../../../../src/lawmind/guardian/types.ts";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import { listBlockingGateDecisions, scrollToFirstBlocker } from "./lawmind-gate-display";
import { lawyerDeliverableTypeLabel } from "./lawmind-lawyer-labels";

type Props = {
  acceptance: AcceptanceReport | null;
  citation: DraftCitationIntegrityView | null;
  deliverableType?: string | null;
  gateDecisions?: GateDecision[];
  /** 核对明细折叠条：一行就绪，不含标题。 */
  variant?: "block" | "summary";
  checklistBlocksApprove?: boolean;
  lintReport?: LegalLintReport | null;
  /** Bounded self-revise line from middleware or local preview. */
  selfRevise?: Pick<SelfReviseResult, "summaryZh"> | null;
  /** Independent Guardian (not the writer's craft_check). */
  guardian?: GuardianLawyerView | null;
};

function scrollToCitation(): void {
  document.getElementById("lm-review-citation-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function LawmindReviewSelfCheckSummary(props: Props): ReactNode {
  const {
    acceptance,
    citation,
    deliverableType,
    gateDecisions,
    variant = "block",
    checklistBlocksApprove = false,
    lintReport = null,
    selfRevise = null,
    guardian = null,
  } = props;

  const blockingGates = listBlockingGateDecisions(gateDecisions);
  const firstGate = blockingGates[0];

  const dtypeLabel =
    lawyerDeliverableTypeLabel(acceptance?.deliverableType) ||
    lawyerDeliverableTypeLabel(deliverableType);

  const scaffoldBlocked = acceptance?.checks.some(
    (c) => c.key === "draft.scaffold_density" && !c.passed && c.severity === "blocker",
  );
  const accLine = !acceptance
    ? "出稿检查：—"
    : scaffoldBlocked
      ? "出稿检查：仍为骨架稿"
      : !acceptance.deliverableType
        ? "出稿检查：未声明类型"
        : acceptance.ready
          ? `出稿检查：通过${dtypeLabel ? ` · ${dtypeLabel}` : ""}`
          : `出稿检查：未过 · ${acceptance.blockerCount}/${acceptance.warningCount}`;

  const citeLine = !citation?.checked
    ? "引用：—"
    : citation.ok
      ? "引用：一致"
      : `引用：待核 · ${citation.missingSourceIds.length}`;

  const typeLine = dtypeLabel ? `类型：${dtypeLabel}` : "类型：—";

  const gateLine = firstGate
    ? `${firstGate.reason ?? "出稿检查未通过"}（点击查看）`
    : null;

  const researchHints: string[] = [];
  const dt = acceptance?.deliverableType || deliverableType || "";
  if (dt === "report.compliance") {
    researchHints.push("核对：大纲已确认 · 管辖矩阵 · 来源附录 · [VERIFY]");
  } else if (dt === "report.learning") {
    researchHints.push("核对：大纲已确认 · 效力层级 · 来源");
  } else if (dt === "ppt.training") {
    researchHints.push("核对：大纲已确认 · 已脱敏 · 短句可讲");
  }

  const checkLine = checklistBlocksApprove ? "必核：未齐" : null;
  const lintLine = !lintReport
    ? null
    : lintReport.blockerCount > 0
      ? `机械核对：${lintReport.blockerCount} 项须处理`
      : lintReport.warningCount > 0
        ? `机械核对：${lintReport.warningCount} 项提示`
        : "机械核对：未见已知缺陷";
  const guardianLine = !guardian
    ? null
    : guardian.verdict === "pass"
      ? "独立审稿：通过"
      : guardian.verdict === "fail"
        ? `独立审稿：未过 · ${guardian.gaps.length}`
        : guardian.skipReason === "disabled" || guardian.skipReason === "no_model"
          ? "独立审稿：未跑"
          : "独立审稿：未完成";
  const summaryOnly = variant === "summary";

  return (
    <div
      className={`lm-review-self-check${summaryOnly ? " lm-review-self-check-summary" : ""}`}
      role={summaryOnly ? undefined : "region"}
      aria-label={summaryOnly ? undefined : "交卷核对"}
    >
      {summaryOnly ? null : <div className="lm-review-self-check-title">交卷核对</div>}
      <div className="lm-review-self-check-lines">
        <span className="lm-review-self-check-line">{typeLine}</span>
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        {summaryOnly ? (
          <span className="lm-review-self-check-line">{gateLine ?? accLine}</span>
        ) : (
          <button
            type="button"
            className="lm-review-self-check-link"
            onClick={() => scrollToFirstBlocker(gateDecisions, acceptance)}
          >
            {gateLine ?? accLine}
          </button>
        )}
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        {summaryOnly ? (
          <span className="lm-review-self-check-line">{citeLine}</span>
        ) : (
          <button type="button" className="lm-review-self-check-link" onClick={() => scrollToCitation()}>
            {citeLine}
          </button>
        )}
        {checkLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <span className="lm-review-self-check-line">{checkLine}</span>
          </>
        ) : null}
        {lintLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <span className="lm-review-self-check-line" data-testid="lm-review-lint-line">
              {lintLine}
            </span>
          </>
        ) : null}
        {selfRevise?.summaryZh ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <span className="lm-review-self-check-line" data-testid="lm-review-self-revise-line">
              {selfRevise.summaryZh}
            </span>
          </>
        ) : null}
        {guardianLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <span className="lm-review-self-check-line" data-testid="lm-review-guardian-line">
              {guardianLine}
            </span>
          </>
        ) : null}
      </div>
      {researchHints.length > 0 ? (
        <div className="lm-review-self-check-lines" data-testid="lm-review-research-hints">
          <span className="lm-review-self-check-line lm-meta">{researchHints.join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
}
