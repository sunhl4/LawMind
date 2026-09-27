/**
 * 在办空态：没有要跟进的交办 / 本案筛选无结果。
 */

import type { ReactNode } from "react";

export type LawmindAgentFleetEmptyProps = {
  kind: "decision" | "filter";
  onOpenChat?: () => void;
  onOpenReview?: () => void;
  onClearMatterFilter?: () => void;
};

export function LawmindAgentFleetEmpty(props: LawmindAgentFleetEmptyProps): ReactNode {
  if (props.kind === "filter") {
    return (
      <div className="lm-agents-wb-empty" data-testid="lm-fleet-filter-empty">
        <h2>本案没有要跟进的</h2>
        <button
          type="button"
          className="lm-btn lm-btn-secondary"
          onClick={() => props.onClearMatterFilter?.()}
        >
          查看全部案件
        </button>
      </div>
    );
  }
  return (
    <div className="lm-agents-wb-empty" data-testid="lm-fleet-decision-empty">
        <h2>现在没有要跟进的</h2>
      <p>去对话交办。办完，或需要你看的时候，会回到这里。</p>
      <div className="lm-agents-wb-empty-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent"
          data-testid="lm-fleet-empty-chat"
          onClick={() => props.onOpenChat?.()}
        >
          去对话
        </button>
        {props.onOpenReview ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            data-testid="lm-fleet-empty-review"
            onClick={() => props.onOpenReview?.()}
          >
            看修订
          </button>
        ) : null}
      </div>
    </div>
  );
}
