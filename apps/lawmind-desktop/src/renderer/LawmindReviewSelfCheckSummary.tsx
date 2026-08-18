/**
 * 审核台首屏：聚合验收门禁、引用一致性、条款图、骨架稿，便于律师先扫一眼再读正文。
 */

import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftScaffoldView } from "../../../../src/lawmind/deliverables/scaffold-status.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";
import { clauseGraphSummaryLine } from "./lawmind-clause-graph-copy";

type Props = {
  acceptance: AcceptanceReport | null;
  citation: DraftCitationIntegrityView | null;
  deliverableType?: string | null;
  clauses?: ClauseGraph | null;
  scaffold?: DraftScaffoldView | null;
  criticCount?: number;
};

function scrollToAcceptance(): void {
  document.getElementById("lm-review-acceptance-gate")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scrollToCitation(): void {
  document.getElementById("lm-review-citation-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scrollToClauses(): void {
  document.getElementById("lm-review-clause-graph")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scrollToCritic(): void {
  document.getElementById("lm-review-critic-notes")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function LawmindReviewSelfCheckSummary(props: Props): ReactNode {
  const { acceptance, citation, deliverableType, clauses, scaffold, criticCount = 0 } = props;

  const accLine = !acceptance
    ? "验收：—"
    : !acceptance.deliverableType
      ? "验收：未声明类型"
      : acceptance.ready
        ? `验收：通过 · ${acceptance.deliverableType}`
        : `验收：未过 · ${acceptance.blockerCount}/${acceptance.warningCount}`;

  const citeLine = !citation?.checked
    ? "引用：—"
    : citation.ok
      ? "引用：一致"
      : `引用：待核 · ${citation.missingSourceIds.length}`;

  const dtype = acceptance?.deliverableType?.trim() || deliverableType?.trim() || "";
  const typeLine = dtype ? `类型：${dtype}` : "类型：—";
  const scaffoldLine = scaffold?.dense ? "骨架：是" : scaffold ? "骨架：否" : null;
  const clauseLine = clauses ? clauseGraphSummaryLine(clauses) : null;
  const criticLine = criticCount > 0 ? `复核：${criticCount}` : null;

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
        {scaffoldLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <button type="button" className="lm-review-self-check-link" onClick={() => scrollToAcceptance()}>
              {scaffoldLine}
            </button>
          </>
        ) : null}
        {clauseLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <button type="button" className="lm-review-self-check-link" onClick={() => scrollToClauses()}>
              {clauseLine}
            </button>
          </>
        ) : null}
        {criticLine ? (
          <>
            <span className="lm-review-self-check-sep" aria-hidden>
              ·
            </span>
            <button type="button" className="lm-review-self-check-link" onClick={() => scrollToCritic()}>
              {criticLine}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
