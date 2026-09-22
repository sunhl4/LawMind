import type { ReactNode } from "react";
import { pathBasename, internalIdsTitle } from "../display-ids";
import { MatterCockpit } from "./MatterCockpit";
import {
  DraftAcceptanceBadge,
  type AcceptanceSummaryItem,
} from "./matter-acceptance-display";
import type { MatterWorkspaceAcceptance } from "./useMatterWorkbench";

type Props = {
  matterId: string;
  matterTitle: string;
  matterStatusLabel: string;
  showDashboard: boolean;
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
  children?: ReactNode;
};

export function MatterOverviewPanel(props: Props): ReactNode {
  const {
    matterId,
    matterTitle,
    matterStatusLabel,
    showDashboard,
    workspaceAcceptance,
    workspaceAcceptanceErr,
    children,
  } = props;

  return (
    <MatterCockpit matterId={matterId} title={matterTitle} status={matterStatusLabel}>
      {showDashboard ? (
        <section className="lm-matter-cockpit-card lm-matter-workspace-acceptance-card">
          <h3>工作区交付就绪概览</h3>
          {workspaceAcceptanceErr ? (
            <div className="lm-callout lm-callout-danger" role="alert">
              <p className="lm-callout-body">{workspaceAcceptanceErr}</p>
            </div>
          ) : null}
          {!workspaceAcceptance && !workspaceAcceptanceErr ? (
            <p className="lm-meta">加载中…</p>
          ) : null}
          {workspaceAcceptance ? (
            <>
              {workspaceAcceptance.items.some((item) => item.hasSpec && !item.ready) ? (
                <section
                  className="lm-matter-delivery-blockers lm-callout lm-callout-warn"
                  aria-label="交付阻断"
                >
                  <h4>交付阻断</h4>
                  <ul className="lm-matter-ops-list">
                    {workspaceAcceptance.items
                      .filter((item) => item.hasSpec && !item.ready)
                      .slice(0, 6)
                      .map((item) => (
                        <li key={`blocker-${item.taskId}`}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <DraftAcceptanceBadge acc={item} />
                          </div>
                          {item.topBlockers && item.topBlockers.length > 0 ? (
                            <ul className="lm-meta">
                              {item.topBlockers.map((b) => (
                                <li key={`${item.taskId}-${b}`}>{b}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="lm-meta">
                              阻断 {item.blockerCount} · 警告 {item.warningCount}
                            </p>
                          )}
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}
              <div className="lm-matter-roadmap-summary-grid">
                <div className="lm-matter-roadmap-summary-card">
                  <span className="lm-meta">草稿总数</span>
                  <strong>{workspaceAcceptance.count}</strong>
                </div>
                <div className="lm-matter-roadmap-summary-card">
                  <span className="lm-meta">验收通过</span>
                  <strong>{workspaceAcceptance.readyCount}</strong>
                </div>
                <div className="lm-matter-roadmap-summary-card">
                  <span className="lm-meta">尚有关阻断</span>
                  <strong>{workspaceAcceptance.blockedCount}</strong>
                </div>
              </div>
              {workspaceAcceptance.items.length === 0 ? (
                <p className="lm-meta">暂无草稿。</p>
              ) : (
                <ul className="lm-matter-ops-list">
                  {workspaceAcceptance.items.slice(0, 8).map((item: AcceptanceSummaryItem) => (
                    <li
                      key={item.taskId}
                      title={internalIdsTitle([
                        { label: "任务编号", value: item.taskId },
                        { label: "案件编号", value: item.matterId ?? undefined },
                      ])}
                    >
                      <div className="lm-matter-ops-title">
                        <span>{item.title}</span>
                        <DraftAcceptanceBadge acc={item} />
                      </div>
                      <div className="lm-matter-ops-meta">
                        {item.outputPath
                          ? `输出文件：${pathBasename(item.outputPath)}`
                          : "尚未渲染输出"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>
      ) : null}
      {children}
    </MatterCockpit>
  );
}
