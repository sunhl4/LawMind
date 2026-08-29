import type { ReactNode } from "react";
import type { DecisionHeader } from "../../../../src/lawmind/delivery/types.ts";

type Props = {
  header: DecisionHeader;
};

export function LawmindDecisionHeader(props: Props): ReactNode {
  const { header } = props;
  const readyLabel = header.ready === "usable" ? "可直接用" : "需定夺";
  return (
    <div
      className={header.ready === "usable" ? "lm-callout lm-callout-info" : "lm-callout lm-callout-warn"}
      role="status"
      data-testid="lm-decision-header"
      data-ready={header.ready}
    >
      <p className="lm-callout-title">本轮决策</p>
      <p className="lm-callout-body">改了什么：{header.changed}</p>
      <p className="lm-callout-body">为什么：{header.why}</p>
      <p className="lm-callout-body">风险：{header.risk}</p>
      <p className="lm-callout-body">{readyLabel}</p>
    </div>
  );
}
