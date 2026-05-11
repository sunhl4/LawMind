import type { CollabEvent, DelegationRow, HistoryItem, TaskRow } from "./lawmind-app-data";
import { internalIdsTitle, pathBasename } from "./display-ids";
import type { TimeRangeFilter } from "./lawmind-time-range";

export function countActiveDelegations(delegations: DelegationRow[]): number {
  return delegations.filter(
    (delegation) => delegation.status === "running" || delegation.status === "pending",
  ).length;
}

export type LawmindRecordsPanelProps = {
  sideTab: "tasks" | "history";
  taskListQuery: string;
  listTimeRange: TimeRangeFilter;
  filteredTasks: TaskRow[];
  filteredHistory: HistoryItem[];
  onSelectSideTab: (tab: "tasks" | "history") => void;
  onTaskListQueryChange: (value: string) => void;
  onListTimeRangeChange: (value: TimeRangeFilter) => void;
  onOpenDetail: (kind: "task" | "draft", id: string) => void | Promise<void>;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
};

/** 侧栏「在办与记录」嵌入（当前助手视角，扁平列表） */
export function LawmindRecordsPanel({
  sideTab,
  taskListQuery,
  listTimeRange,
  filteredTasks,
  filteredHistory,
  onSelectSideTab,
  onTaskListQueryChange,
  onListTimeRangeChange,
  onOpenDetail,
  formatRelativeTime,
  legalStatusLabel,
  taskBadgeClass,
  historyBadgeClass,
}: LawmindRecordsPanelProps) {
  return (
    <div className="lm-records-body lm-records-body-page">
      <div className="lm-records-toolbar">
        <div className="lm-sidebar-filters lm-records-toolbar-filters">
          <input
            type="search"
            className="lm-sidebar-search"
            placeholder="搜索任务、交付物或案件…"
            value={taskListQuery}
            onChange={(e) => onTaskListQueryChange(e.target.value)}
            aria-label="搜索任务与历史"
          />
          <select
            className="lm-sidebar-range"
            value={listTimeRange}
            onChange={(e) => onListTimeRangeChange(e.target.value as TimeRangeFilter)}
            aria-label="时间范围"
          >
            <option value="all">全部</option>
            <option value="today">今天</option>
            <option value="7d">7天</option>
            <option value="30d">30天</option>
          </select>
        </div>
      </div>
      <div className="lm-tabs">
        <button
          type="button"
          className={`lm-tab ${sideTab === "tasks" ? "active" : ""}`}
          onClick={() => onSelectSideTab("tasks")}
        >
          任务
        </button>
        <button
          type="button"
          className={`lm-tab ${sideTab === "history" ? "active" : ""}`}
          onClick={() => onSelectSideTab("history")}
        >
          交付
        </button>
      </div>
      {sideTab === "tasks" && (
        <ul className="lm-list">
          {filteredTasks.length === 0 && <li className="lm-list-empty">暂无任务记录</li>}
          {filteredTasks.map((task) => {
            const headline = (task.title?.trim() ? task.title : task.summary).slice(0, 100);
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
                  {task.matterId ? (
                    <span
                      className="lm-matter-badge"
                      title={internalIdsTitle([{ label: "案件编号", value: task.matterId }])}
                    >
                      关联案件
                    </span>
                  ) : null}
                </div>
                <div className="lm-list-time">{formatRelativeTime(task.updatedAt)}</div>
                {task.outputPath ? (
                  <div className="lm-list-path" title={task.outputPath}>
                    {pathBasename(task.outputPath)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {sideTab === "history" && (
        <ul className="lm-list">
          {filteredHistory.length === 0 && <li className="lm-list-empty">暂无历史</li>}
          {filteredHistory.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="lm-list-clickable"
              tabIndex={0}
              onClick={() => void onOpenDetail(item.kind, item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void onOpenDetail(item.kind, item.id);
                }
              }}
            >
              <div className="lm-list-row">
                <span className={historyBadgeClass(item.kind, item.taskRecordKind, item.status)}>
                  {legalStatusLabel(item.status ?? item.kind, item.taskRecordKind)}
                </span>
                <span className="lm-list-title">{item.label}</span>
                {item.matterId ? (
                  <span
                    className="lm-matter-badge"
                    title={internalIdsTitle([{ label: "案件编号", value: item.matterId }])}
                  >
                    关联案件
                  </span>
                ) : null}
              </div>
              <div className="lm-list-time">{formatRelativeTime(item.updatedAt)}</div>
              {item.outputPath ? (
                <div className="lm-list-path" title={item.outputPath}>
                  {pathBasename(item.outputPath)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type LawmindCollabPanelProps = {
  collabTab: "delegations" | "timeline";
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  onSelectCollabTab: (tab: "delegations" | "timeline") => void;
  formatRelativeTime: (iso: string) => string;
  /** 打开目标助手承接该委派的会话（工作区主对话） */
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  /** 协作页「状态一览」主区内：占满可视高度，列表更可扫读 */
  variant?: "standard" | "desk";
};

/** 协作委派与动态（整页 / 侧栏内共用） */
export function LawmindCollabPanel({
  collabTab,
  delegations,
  collabEvents,
  onSelectCollabTab,
  formatRelativeTime,
  onOpenDelegationTargetChat,
  variant = "standard",
}: LawmindCollabPanelProps) {
  const panelClass =
    variant === "desk"
      ? "lm-records-body lm-records-body-page lm-collab-panel-desk"
      : "lm-records-body lm-records-body-page";
  return (
    <div className={panelClass}>
      <div className="lm-tabs">
        <button
          type="button"
          className={`lm-tab ${collabTab === "delegations" ? "active" : ""}`}
          onClick={() => onSelectCollabTab("delegations")}
        >
          委派任务
          <span className="lm-section-count lm-tab-inline-count">{countActiveDelegations(delegations)}</span>
        </button>
        <button
          type="button"
          className={`lm-tab ${collabTab === "timeline" ? "active" : ""}`}
          onClick={() => onSelectCollabTab("timeline")}
        >
          协作动态
        </button>
      </div>
      {collabTab === "delegations" && (
        <ul className="lm-list">
          {delegations.length === 0 && <li className="lm-list-empty">暂无委派任务</li>}
          {delegations.map((delegation) => (
            <li key={delegation.delegationId} className="lm-list-clickable" tabIndex={0}>
              <div className="lm-list-row">
                <span
                  className={`lm-badge ${
                    delegation.status === "completed"
                      ? "lm-badge-done"
                      : delegation.status === "running"
                        ? "lm-badge-running"
                        : delegation.status === "failed" || delegation.status === "timeout"
                          ? "lm-badge-error"
                          : ""
                  }`}
                >
                  {delegation.status === "completed"
                    ? "已完成"
                    : delegation.status === "running"
                      ? "进行中"
                      : delegation.status === "failed"
                        ? "失败"
                        : delegation.status === "timeout"
                          ? "超时"
                          : delegation.status === "pending"
                            ? "等待中"
                            : delegation.status === "cancelled"
                              ? "已取消"
                              : delegation.status}
                </span>
                <span className="lm-list-title">{delegation.task.slice(0, 80)}</span>
              </div>
              <div className="lm-list-time">
                {delegation.fromAssistant} → {delegation.toAssistant}
                {" · "}
                {formatRelativeTime(delegation.startedAt)}
              </div>
              {onOpenDelegationTargetChat ? (
                <div className="lm-delegation-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onOpenDelegationTargetChat(delegation);
                    }}
                  >
                    与目标助手对话
                  </button>
                </div>
              ) : null}
              {delegation.error ? <div className="lm-list-path lm-text-error">{delegation.error}</div> : null}
              {delegation.result ? (
                <div className="lm-list-path">
                  {delegation.result.slice(0, 100)}
                  {delegation.result.length > 100 ? "…" : ""}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {collabTab === "timeline" && (
        <ul className="lm-list">
          {collabEvents.length === 0 && <li className="lm-list-empty">暂无协作动态</li>}
          {[...collabEvents].toReversed().slice(0, 30).map((event) => (
            <li key={event.eventId}>
              <div className="lm-list-row">
                <span className="lm-badge">{event.kind.split(".").pop()}</span>
                <span className="lm-list-title">
                  {event.fromAssistantId} → {event.toAssistantId}
                </span>
              </div>
              <div className="lm-list-time">
                {event.detail?.slice(0, 80)}
                {" · "}
                {formatRelativeTime(event.timestamp)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
