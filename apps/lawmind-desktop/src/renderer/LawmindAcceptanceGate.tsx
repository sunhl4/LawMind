/**
 * <LawmindAcceptanceGate /> — Deliverable-First Architecture surface in the Review workbench.
 */

import { useEffect, useState, type ReactNode } from "react";
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
  /**
   * Prefer collapsed when the report is ready.
   * When not ready / has blockers / placeholders, the gate auto-expands
   * regardless of this flag (9/10 trust packaging).
   */
  defaultCollapsed?: boolean;
};

function severityBadge(severity: "blocker" | "warning"): string {
  return severity === "blocker" ? "lm-badge lm-badge-blocker" : "lm-badge lm-badge-warning";
}

/** True when lawyers must see the checklist without an extra click. */
export function acceptanceGateShouldExpand(
  report: AcceptanceReport,
  reasoning?: ReasoningReport | null,
): boolean {
  if (!report.deliverableType) {
    return false;
  }
  if (!report.ready) {
    return true;
  }
  if ((report.blockerCount ?? 0) > 0) {
    return true;
  }
  if ((report.placeholderCount ?? 0) > 0) {
    return true;
  }
  if (reasoning && reasoning.required && !reasoning.ready) {
    return true;
  }
  return false;
}

export function LawmindAcceptanceGate(props: Props): ReactNode {
  const { report, reasoning, onGoFillInChat, defaultCollapsed = true } = props;
  const forceExpand = report ? acceptanceGateShouldExpand(report, reasoning) : false;
  const [expanded, setExpanded] = useState(() => (forceExpand ? true : !defaultCollapsed));

  useEffect(() => {
    if (!report) {
      return;
    }
    if (acceptanceGateShouldExpand(report, reasoning)) {
      setExpanded(true);
    }
  }, [report, reasoning]);

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

  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failed = checks.filter((c) => !c.passed);
  const placeholders = Array.isArray(report.placeholderSamples) ? report.placeholderSamples : [];
  const headlineClass = report.ready ? "lm-acceptance-ok" : "lm-acceptance-blocked";
  const blockerN =
    report.blockerCount ?? failed.filter((c) => c.severity === "blocker").length;
  const warningN =
    report.warningCount ?? failed.filter((c) => c.severity === "warning").length;
  const summary = report.ready
    ? "已通过"
    : `未通过 · 阻塞 ${blockerN} · 提醒 ${warningN}`;

  return (
    <details
      id="lm-review-acceptance-gate"
      className={`lm-acceptance-gate lm-acceptance-collapsible ${headlineClass}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="lm-acceptance-summary">
        <strong>出稿检查：{summary}</strong>
        <span className="lm-meta">
          {forceExpand ? "（请先处理阻塞项）" : "（点击展开清单）"}
        </span>
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
      {placeholders.length > 0 ? (
        <div className="lm-meta lm-acceptance-placeholders">
          待补占位示例：{placeholders.join("｜")}
        </div>
      ) : null}
      {reasoning ? <ReasoningGateBlock reasoning={reasoning} /> : null}
    </details>
  );
}

function ReasoningGateBlock({ reasoning }: { reasoning: ReasoningReport }): ReactNode {
  const failed = (Array.isArray(reasoning.checks) ? reasoning.checks : []).filter((c) => !c.passed);
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
