/**
 * 在办空态：全所无待办 / 本案筛选无结果。
 */

import type { ReactNode } from "react";

export type LawmindAgentFleetEmptyProps = {
  kind: "decision" | "filter";
  onOpenReview?: () => void;
  onClearMatterFilter?: () => void;
};

export function LawmindAgentFleetEmpty(props: LawmindAgentFleetEmptyProps): ReactNode {
  if (props.kind === "filter") {
    return (
      <div className="lm-agents-wb-empty" data-testid="lm-fleet-filter-empty">
        <h2>本案暂无待办</h2>
        <p>当前案件筛选下没有待拍板项。可切换「全部案件」查看全所队列。</p>
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
      <h2>团队暂无在办</h2>
      <p>
        这里是领导视图：谁在忙、谁卡在补充/签批会列在左侧。新任务请到顶栏「对话」下达。
      </p>
      <div className="lm-agents-wb-empty-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent"
          data-testid="lm-fleet-primary-review"
          onClick={() => props.onOpenReview?.()}
        >
          打开文书台
        </button>
      </div>
    </div>
  );
}
