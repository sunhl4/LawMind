import type { ReactNode } from "react";
import type {
  DecisionHeader,
  DecisionPlaybookSummary,
} from "../../../../src/lawmind/delivery/types.ts";
import { formatJudgmentCoverage } from "../../../../src/lawmind/delivery/decision-header.ts";

type Props = {
  header: DecisionHeader;
};

function playbookVerdictLabel(verdict: DecisionPlaybookSummary["verdict"]): string {
  switch (verdict) {
    case "GREEN":
      return "全部有据通过（仍需签批）";
    case "YELLOW":
      return "需逐项确认";
    case "RED":
      return "须全面审阅";
    default: {
      const never: never = verdict;
      return never;
    }
  }
}

/** 只列非 PASS 项；超过三条截断，不把整张表塞进决策头。 */
function playbookItemsLine(playbook: DecisionPlaybookSummary): string {
  const shown = playbook.items
    .slice(0, 3)
    .map(
      (item) =>
        `${item.title}（${item.result}${item.locator ? ` @${item.locator}` : ""}）`,
    );
  return `${shown.join("、")}${playbook.items.length > shown.length ? "…" : ""}`;
}

export function LawmindDecisionHeader(props: Props): ReactNode {
  const { header } = props;
  const readyLabel = header.ready === "usable" ? "可直接用" : "需定夺";
  // G3：判定主体覆盖自述。不传 coverage 时不显示——不写"核对了 0 项"。
  const coverage = formatJudgmentCoverage(header.judgmentCoverage);
  const playbook = header.playbook;
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
      {header.unverified?.trim() ? (
        <p className="lm-callout-body" data-testid="lm-decision-header-unverified">
          未能核验：{header.unverified.trim()}
        </p>
      ) : null}
      {coverage ? (
        <p className="lm-callout-body" data-testid="lm-decision-header-coverage">
          {coverage}
        </p>
      ) : null}
      {playbook ? (
        <p className="lm-callout-body" data-testid="lm-decision-header-playbook">
          剧本：{playbookVerdictLabel(playbook.verdict)}
          {playbook.basis === "playbook"
            ? `（依据：本所剧本${playbook.playbookName ? `「${playbook.playbookName}」` : ""}，${playbook.counts.pass} 项通过 / ${playbook.counts.flag} 项待定 / ${playbook.counts.fail} 项不符合）`
            : "（通用标准：未加载本所剧本，不代表本所立场）"}
          {playbook.items.length > 0 ? `；待处理：${playbookItemsLine(playbook)}` : ""}
          {playbook.override
            ? `；已由 ${playbook.override.by} 降档：${playbook.override.reason}`
            : ""}
          {playbook.overrideRejected ? "；降档未生效：缺理由或署名" : ""}
        </p>
      ) : null}
      <p className="lm-callout-body">{readyLabel}</p>
    </div>
  );
}
