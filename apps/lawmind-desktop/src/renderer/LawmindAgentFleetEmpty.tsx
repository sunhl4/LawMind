/**
 * 在办空态：全所无待办 / 本案筛选无结果。
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
        <h2>本案暂无待办</h2>
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
        <h2>暂无待办</h2>
      <p>去对话交办；有草稿时也可打开改稿核对。</p>
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
            改稿
          </button>
        ) : null}
      </div>
    </div>
  );
}
