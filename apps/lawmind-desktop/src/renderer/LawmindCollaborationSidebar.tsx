import { useMemo, type ReactNode } from "react";
import type { CollabEvent, DelegationRow, TaskRow } from "./lawmind-app-data";
import {
  LawmindCollabPanel,
  countActiveDelegations,
} from "./lawmind-records-collab-panels";
import { LawmindMatterSidebarList } from "./LawmindMatterSidebarList";
import type { MatterSidebarRow } from "./lawmind-records-desk-state";
import { pathBasename, internalIdsTitle } from "./display-ids";

type Props = {
  actionSummaryTotal: number;
  activeJobs?: number;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  collabTab: "delegations" | "timeline";
  onSelectCollabTab: (tab: "delegations" | "timeline") => void;
  filteredTasks: TaskRow[];
  matterRows?: MatterSidebarRow[];
  selectedMatterKey?: string | null;
  onSelectMatter?: (matterId: string) => void;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  onOpenDetail: (kind: "task" | "draft", id: string) => void | Promise<void>;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  onOpenActionHub?: () => void;
  onRefreshCollaboration?: () => void | Promise<void>;
  collaborationHint?: string;
};

function countInFlightTasks(tasks: TaskRow[]): number {
  return tasks.filter((t) => {
    const s = t.status.toLowerCase();
    return s === "running" || s === "processing" || s === "pending";
  }).length;
}

export function LawmindCollaborationSidebar(props: Props): ReactNode {
  const {
    actionSummaryTotal,
    activeJobs = 0,
    delegations,
    collabEvents,
    collabTab,
    onSelectCollabTab,
    filteredTasks,
    matterRows = [],
    selectedMatterKey = null,
    onSelectMatter,
    formatRelativeTime,
    legalStatusLabel,
    taskBadgeClass,
    onOpenDetail,
    onOpenDelegationTargetChat,
    onOpenActionHub,
    onRefreshCollaboration,
    collaborationHint,
  } = props;

  const activeDelegations = countActiveDelegations(delegations);
  const inFlightTasks = useMemo(() => countInFlightTasks(filteredTasks), [filteredTasks]);
  const recentTasks = useMemo(
    () =>
      [...filteredTasks]
        .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 10),
    [filteredTasks],
  );

  return (
    <div className="lm-collab-sidebar lm-side-scroll" aria-label="工作流上下文">
      <section className="lm-collab-sidebar-stats" aria-label="工作流概览">
        <button
          type="button"
          className="lm-collab-sidebar-stat lm-collab-sidebar-stat-action"
          onClick={() => onOpenActionHub?.()}
          title="打开待办中心"
        >
          <span className="lm-collab-sidebar-stat-value">{actionSummaryTotal}</span>
          <span className="lm-collab-sidebar-stat-label">待办</span>
        </button>
        <div className="lm-collab-sidebar-stat" title="进行中的委派">
          <span className="lm-collab-sidebar-stat-value">{activeDelegations}</span>
          <span className="lm-collab-sidebar-stat-label">委派中</span>
        </div>
        <div className="lm-collab-sidebar-stat" title="进行中的后台任务">
          <span className="lm-collab-sidebar-stat-value">{Math.max(inFlightTasks, activeJobs)}</span>
          <span className="lm-collab-sidebar-stat-label">任务</span>
        </div>
      </section>

      {collaborationHint ? (
        <p className="lm-meta lm-collab-sidebar-hint" role="status">
          {collaborationHint}
        </p>
      ) : null}

      {matterRows.length > 0 && onSelectMatter ? (
        <div className="lm-collab-sidebar-matters">
          <LawmindMatterSidebarList
            rows={matterRows}
            selectedKey={selectedMatterKey}
            onSelect={onSelectMatter}
          />
        </div>
      ) : null}

      <div className="lm-collab-sidebar-panel">
        <div className="lm-collab-sidebar-panel-head">
          <span className="lm-collab-sidebar-panel-title">委派与动态</span>
          {onRefreshCollaboration ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => void onRefreshCollaboration()}
              aria-label="刷新工作流数据"
            >
              刷新
            </button>
          ) : null}
        </div>
        <LawmindCollabPanel
          collabTab={collabTab}
          delegations={delegations}
          collabEvents={collabEvents}
          onSelectCollabTab={onSelectCollabTab}
          formatRelativeTime={formatRelativeTime}
          onOpenDelegationTargetChat={onOpenDelegationTargetChat}
        />
      </div>

      <section className="lm-collab-sidebar-tasks" aria-label="近期任务">
        <div className="lm-collab-sidebar-panel-head">
          <span className="lm-collab-sidebar-panel-title">近期任务</span>
          <span className="lm-section-count">{filteredTasks.length}</span>
        </div>
        <ul className="lm-list lm-collab-sidebar-task-list">
          {recentTasks.length === 0 ? (
            <li className="lm-list-empty">当前助手暂无任务记录</li>
          ) : (
            recentTasks.map((task) => {
              const headline = (task.title?.trim() ? task.title : task.summary).slice(0, 88);
              return (
                <li
                  key={task.taskId}
                  className="lm-list-clickable"
                  tabIndex={0}
                  onClick={() => void onOpenDetail("task", task.taskId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void onOpenDetail("task", task.taskId);
                    }
                  }}
                >
                  <div className="lm-list-row">
                    <span className={taskBadgeClass(task.status, task.kind)}>
                      {legalStatusLabel(task.status, task.kind)}
                    </span>
                    <span className="lm-list-title">{headline}</span>
                  </div>
                  <div className="lm-list-time">
                    {formatRelativeTime(task.updatedAt)}
                    {task.matterId ? (
                      <>
                        {" · "}
                        <span
                          className="lm-matter-badge lm-matter-badge-inline"
                          title={internalIdsTitle([{ label: "案件编号", value: task.matterId }])}
                        >
                          案件
                        </span>
                      </>
                    ) : null}
                  </div>
                  {task.outputPath ? (
                    <div className="lm-list-path" title={task.outputPath}>
                      {pathBasename(task.outputPath)}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}
