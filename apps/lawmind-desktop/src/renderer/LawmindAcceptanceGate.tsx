/**
 * <LawmindAcceptanceGate /> — Deliverable-First Architecture surface in the Review workbench.
 *
 * 显示验收报告（缺失章节、占位符样例、未答待确认问题），并通过 `report.ready` 决定调用方
 * 是否允许渲染。注意：本组件**不**直接调用 render，只显示状态；ReviewWorkbench 根据 `ready`
 * 决定是否禁用「渲染交付物」按钮。
 */

import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";

type Props = {
  report: AcceptanceReport | null | undefined;
};

function severityBadge(severity: "blocker" | "warning"): string {
  return severity === "blocker" ? "lm-badge lm-badge-blocker" : "lm-badge lm-badge-warning";
}

export function LawmindAcceptanceGate(props: Props): ReactNode {
  const { report } = props;
  if (!report) {
    return null;
  }
  if (!report.deliverableType) {
    return (
      <div id="lm-review-acceptance-gate" className="lm-meta lm-acceptance-skip">
        验收门禁：本草稿未声明交付物类型，按通用文书放行（不显示门禁清单）。
      </div>
    );
  }
  const failed = report.checks.filter((c) => !c.passed);
  const headlineClass = report.ready ? "lm-acceptance-ok" : "lm-acceptance-blocked";
  return (
    <div
      id="lm-review-acceptance-gate"
      className={`lm-acceptance-gate ${headlineClass}`}
      role="region"
      aria-label="验收门禁"
    >
      <div className="lm-acceptance-headline">
        <strong>验收门禁：{report.ready ? "已通过" : "未通过"}</strong>
        <span className="lm-meta">
          交付类型 {report.deliverableType} · blockers {report.blockerCount} · warnings{" "}
          {report.warningCount} · 占位符 {report.placeholderCount}
        </span>
      </div>
      {!report.ready && failed.length > 0 && (
        <ul className="lm-acceptance-list">
          {failed.map((c) => (
            <li key={`${c.key}-${c.label}`}>
              <span className={severityBadge(c.severity)}>{c.severity === "blocker" ? "阻塞" : "提醒"}</span>
              <span className="lm-acceptance-label">{c.label}</span>
              {c.hint ? <span className="lm-meta lm-acceptance-detail">{c.hint}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {report.placeholderSamples.length > 0 && (
        <div className="lm-meta lm-acceptance-placeholders">
          占位符样例：{report.placeholderSamples.join("｜")}
        </div>
      )}
    </div>
  );
}
