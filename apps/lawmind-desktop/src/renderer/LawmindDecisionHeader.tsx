import type { ReactNode } from "react";
import type { DecisionHeader } from "../../../../src/lawmind/delivery/types.ts";
import { formatJudgmentCoverage } from "../../../../src/lawmind/delivery/decision-header.ts";

type Props = {
  header: DecisionHeader;
};

export function LawmindDecisionHeader(props: Props): ReactNode {
  const { header } = props;
  const readyLabel = header.ready === "usable" ? "可直接用" : "需定夺";
  // G3：判定主体覆盖自述。不传 coverage 时不显示——不写"核对了 0 项"。
  const coverage = formatJudgmentCoverage(header.judgmentCoverage);
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
      {coverage ? (
        <p className="lm-callout-body" data-testid="lm-decision-header-coverage">
          {coverage}
        </p>
      ) : null}
      <p className="lm-callout-body">{readyLabel}</p>
    </div>
  );
}
