/**
 * <LawmindAcceptanceGate /> — Deliverable-First Architecture surface in the Review workbench.
 */

import { useState, type ReactNode } from "react";
import type {
  AcceptanceReport,
  ReasoningReport,
} from "../../../../src/lawmind/deliverables/index.ts";
import { humanizeAcceptanceLabel, buildAcceptanceChatPrompt } from "./lawmind-acceptance-labels";

type Props = {
  report: AcceptanceReport | null | undefined;
  reasoning?: ReasoningReport | null;
  /** When set, failed blockers show「去对话补充」 */
  onGoFillInChat?: (prompt: string) => void;
  defaultCollapsed?: boolean;
};

function severityBadge(severity: "blocker" | "warning"): string {
  return severity === "blocker" ? "lm-badge lm-badge-blocker" : "lm-badge lm-badge-warning";
}

export function LawmindAcceptanceGate(props: Props): ReactNode {
  const { report, reasoning, onGoFillInChat, defaultCollapsed = true } = props;
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  if (!report) {
    return null;
  }
  if (!report.deliverableType) {
    return (
      <div id="lm-review-acceptance-gate" className="lm-meta lm-acceptance-skip">
        本草稿未声明交付物类型，按通用文书放行。
      </div>
    );
  }

  const failed = report.checks.filter((c) => !c.passed);
  const headlineClass = report.ready ? "lm-acceptance-ok" : "lm-acceptance-blocked";
  const summary = report.ready
    ? "已通过"
    : `未通过 · 阻塞 ${report.blockerCount} · 提醒 ${report.warningCount}`;

  return (
    <details
      id="lm-review-acceptance-gate"
      className={`lm-acceptance-gate lm-acceptance-collapsible ${headlineClass}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="lm-acceptance-summary">
        <strong>出稿检查：{summary}</strong>
        <span className="lm-meta">（点击展开清单）</span>
      </summary>
      {!report.ready && failed.length > 0 ? (
        <ul className="lm-acceptance-list">
          {failed.map((c) => (
            <li key={`${c.key}-${c.label}`}>
              <span className={severityBadge(c.severity)}>{c.severity === "blocker" ? "阻塞" : "提醒"}</span>
              <span className="lm-acceptance-label">{humanizeAcceptanceLabel(c.key, c.label)}</span>
              {c.hint ? <span className="lm-meta lm-acceptance-detail">{c.hint}</span> : null}
              {onGoFillInChat && c.severity === "blocker" ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => onGoFillInChat(buildAcceptanceChatPrompt(report))}
                >
                  去对话补充
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {report.placeholderSamples.length > 0 ? (
        <div className="lm-meta lm-acceptance-placeholders">
          待补占位示例：{report.placeholderSamples.join("｜")}
        </div>
      ) : null}
      {reasoning ? <ReasoningGateBlock reasoning={reasoning} /> : null}
    </details>
  );
}

function ReasoningGateBlock({ reasoning }: { reasoning: ReasoningReport }): ReactNode {
  const failed = reasoning.checks.filter((c) => !c.passed);
  if (!reasoning.required && failed.length === 0) {
    return null;
  }
  const headline = reasoning.ready ? "已通过" : "未通过";
  const headlineClass = reasoning.ready ? "lm-acceptance-ok" : "lm-acceptance-blocked";
  return (
    <div className={`lm-acceptance-reasoning ${headlineClass}`} role="region" aria-label="推理检查">
      <div className="lm-acceptance-headline">
        <strong>推理检查：{headline}</strong>
      </div>
      {failed.length > 0 ? (
        <ul className="lm-acceptance-list">
          {failed.map((c) => (
            <li key={`reasoning-${c.key}`}>
              <span className={severityBadge(c.severity)}>
                {c.severity === "blocker" ? "阻塞" : "提醒"}
              </span>
              <span className="lm-acceptance-label">{humanizeAcceptanceLabel(c.key, c.label)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
