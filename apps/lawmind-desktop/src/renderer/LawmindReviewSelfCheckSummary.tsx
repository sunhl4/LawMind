/**
 * 审核台首屏：聚合验收门禁、引用一致性、交付类型，便于律师先扫一眼再读正文。
 */

import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";

type Props = {
  acceptance: AcceptanceReport | null;
  citation: DraftCitationIntegrityView | null;
  deliverableType?: string | null;
};

function scrollToAcceptance(): void {
  document.getElementById("lm-review-acceptance-gate")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scrollToCitation(): void {
  document.getElementById("lm-review-citation-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function LawmindReviewSelfCheckSummary(props: Props): ReactNode {
  const { acceptance, citation, deliverableType } = props;

  const accLine = !acceptance
    ? "验收：未跑门禁（无报告）"
    : !acceptance.deliverableType
      ? "验收：未声明交付类型（按通用放行）"
      : acceptance.ready
        ? `验收：已通过（${acceptance.deliverableType}）`
        : `验收：未通过 · 阻塞 ${acceptance.blockerCount} · 提醒 ${acceptance.warningCount}`;

  const citeLine = !citation?.checked
    ? "引用：未校验"
    : citation.ok
      ? "引用：与检索 bundle 一致"
      : `引用：待核对 · 缺失来源 ${citation.missingSourceIds.length} 处`;

  const dtype = acceptance?.deliverableType?.trim() || deliverableType?.trim() || "";
  const typeLine = dtype ? `交付类型：${dtype}` : "交付类型：（草稿未标注）";

  return (
    <div className="lm-review-self-check" role="region" aria-label="助理自检摘要">
      <div className="lm-review-self-check-title">助理自检摘要</div>
      <div className="lm-review-self-check-lines">
        <span className="lm-review-self-check-line">{typeLine}</span>
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        <button type="button" className="lm-review-self-check-link" onClick={() => scrollToAcceptance()}>
          {accLine}
        </button>
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        <button type="button" className="lm-review-self-check-link" onClick={() => scrollToCitation()}>
          {citeLine}
        </button>
      </div>
      <div className="lm-meta lm-review-self-check-hint">点击行可跳转到下方门禁或引用条</div>
    </div>
  );
}
