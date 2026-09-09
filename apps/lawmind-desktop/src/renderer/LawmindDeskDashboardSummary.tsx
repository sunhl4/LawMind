import type { ReactNode } from "react";
import type { LawyerDeskDashboard } from "../../../../src/lawmind/metrics/lawyer-dashboard.ts";

export type LawmindDeskDashboardSummaryProps = {
  dashboard: LawyerDeskDashboard | null;
  loading?: boolean;
  testId?: string;
};

/**
 * LawmindDesk 仪表盘汇总条：待拍板总数、今日活动数、本周 first-pass 数。
 */
export function LawmindDeskDashboardSummary(props: LawmindDeskDashboardSummaryProps): ReactNode {
  const { dashboard, loading, testId = "lm-desk-dashboard-summary" } = props;

  if (loading) {
    return (
      <p className="lm-meta lm-desk-dashboard-summary" aria-busy="true">
        仪表盘加载中…
      </p>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="lm-desk-dashboard-summary" data-testid={testId}>
      <span className="lm-desk-dashboard-summary-item" data-testid={`${testId}-pending`}>
        <strong>{dashboard.totalPendingApprovals}</strong>
        <span>项待拍板</span>
      </span>
      <span className="lm-desk-dashboard-summary-item" data-testid={`${testId}-today`}>
        <strong>{dashboard.todayActivityCount}</strong>
        <span>今日活动</span>
      </span>
      <span className="lm-desk-dashboard-summary-item" data-testid={`${testId}-first-pass`}>
        <strong>{dashboard.thisWeekFirstPassCount}</strong>
        <span>本周一次过</span>
      </span>
      {dashboard.totalOverdueTasks > 0 ? (
        <span
          className="lm-desk-dashboard-summary-item lm-desk-dashboard-summary-item--warn"
          data-testid={`${testId}-overdue`}
        >
          <strong>{dashboard.totalOverdueTasks}</strong>
          <span>项逾期</span>
        </span>
      ) : null}
    </div>
  );
}
