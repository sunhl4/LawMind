import type { ReactNode } from "react";
import type { MatterHealthMetrics } from "../../../../../src/lawmind/metrics/lawyer-dashboard.ts";
import { formatShortDateTime } from "./matter-display-labels.js";

export type LawmindMatterHealthCardProps = {
  matterId: string;
  displayName?: string;
  /** When false, skip repeating the page title; show a compact status strip. */
  showTitle?: boolean;
  metrics: MatterHealthMetrics;
  onClick?: () => void;
  testId?: string;
};

const PHASE_LABELS: Record<MatterHealthMetrics["phase"], string> = {
  intake: "交办",
  draft: "改稿",
  review: "签批",
  delivery: "交付",
  closed: "结案",
};

function coverageLabel(metrics: MatterHealthMetrics): string {
  if (metrics.lintCoverageRate === null) {
    return "未核对";
  }
  return `${Math.round(metrics.lintCoverageRate * 100)}% 已核对`;
}

function pendingLabel(count: number): string | null {
  return count > 0 ? `${count} 项待拍板` : null;
}

function overdueLabel(count: number): string {
  return count > 0 ? `${count} 项逾期` : "";
}

/**
 * 案件级健康卡片：用律师语言展示真实可解释指标，无「安全分」。
 */
export function LawmindMatterHealthCard(props: LawmindMatterHealthCardProps): ReactNode {
  const {
    matterId,
    displayName,
    showTitle = true,
    metrics,
    onClick,
    testId = "lm-matter-health-card",
  } = props;
  const title = displayName?.trim() || matterId;
  const phase = PHASE_LABELS[metrics.phase] ?? "—";
  const pendingText = pendingLabel(metrics.pendingApprovals);
  const overdueText = overdueLabel(metrics.overdueTasks);
  const className = showTitle
    ? "lm-matter-health-card"
    : "lm-matter-health-card lm-matter-health-card--compact";

  const body = (
    <>
      <div className="lm-matter-health-card-head">
        {showTitle ? <span className="lm-matter-health-card-title">{title}</span> : null}
        <span className="lm-matter-health-card-phase" data-testid={`${testId}-phase`}>
          {phase}
        </span>
      </div>
      <div className="lm-matter-health-card-metrics">
        {pendingText ? (
          <span
            className="lm-matter-health-card-pill lm-matter-health-card-pill--warn"
            data-testid={`${testId}-pending`}
          >
            {pendingText}
          </span>
        ) : null}
        <span className="lm-matter-health-card-pill" data-testid={`${testId}-coverage`}>
          {coverageLabel(metrics)}
        </span>
        {overdueText ? (
          <span
            className="lm-matter-health-card-pill lm-matter-health-card-pill--warn"
            data-testid={`${testId}-overdue`}
          >
            {overdueText}
          </span>
        ) : null}
      </div>
      <div className="lm-matter-health-card-meta" data-testid={`${testId}-activity`}>
        最近活动：{metrics.lastActivityAt ? formatShortDateTime(metrics.lastActivityAt) : "—"}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        data-testid={testId}
        data-matter-id={matterId}
        onClick={() => onClick()}
        title={`查看案件 ${title}`}
      >
        {body}
      </button>
    );
  }

  return (
    <article className={className} data-testid={testId} data-matter-id={matterId}>
      {body}
    </article>
  );
}
