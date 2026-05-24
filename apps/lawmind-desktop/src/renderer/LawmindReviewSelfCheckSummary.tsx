/**
 * 审核台首屏：聚合验收门禁、引用一致性、交付类型，便于律师先扫一眼再读正文。
 */

import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import { listBlockingGateDecisions, scrollToFirstBlocker } from "./lawmind-gate-display";

type Props = {
  acceptance: AcceptanceReport | null;
  citation: DraftCitationIntegrityView | null;
  deliverableType?: string | null;
  gateDecisions?: GateDecision[];
};

function scrollToCitation(): void {
  document.getElementById("lm-review-citation-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function LawmindReviewSelfCheckSummary(props: Props): ReactNode {
  const { acceptance, citation, deliverableType, gateDecisions } = props;

  const blockingGates = listBlockingGateDecisions(gateDecisions);
  const firstGate = blockingGates[0];

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

  const gateLine = firstGate
    ? `${firstGate.reason ?? "交付门禁未通过"}（点击查看）`
    : null;

  return (
    <div className="lm-review-self-check" role="region" aria-label="助理自检摘要">
      <div className="lm-review-self-check-title">助理自检摘要</div>
      <div className="lm-review-self-check-lines">
        <span className="lm-review-self-check-line">{typeLine}</span>
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="lm-review-self-check-link"
          onClick={() => scrollToFirstBlocker(gateDecisions, acceptance)}
        >
          {gateLine ?? accLine}
        </button>
        <span className="lm-review-self-check-sep" aria-hidden>
          ·
        </span>
        <button type="button" className="lm-review-self-check-link" onClick={() => scrollToCitation()}>
          {citeLine}
        </button>
      </div>
    </div>
  );
}
