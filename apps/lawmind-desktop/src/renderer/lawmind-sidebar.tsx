import type { CollabEvent, DelegationRow, HistoryItem, TaskRow } from "./lawmind-app-data";

export type TimeRangeFilter = "all" | "today" | "7d" | "30d";

export function countActiveDelegations(delegations: DelegationRow[]): number {
  return delegations.filter((delegation) => delegation.status === "running" || delegation.status === "pending").length;
}

type Props = {
  projectDir: string | null;
  assistants: Array<{ assistantId: string; displayName: string }>;
  selectedAssistantId: string;
  recordsExpanded: boolean;
  collabExpanded: boolean;
  collabTab: "delegations" | "timeline";
  sideTab: "tasks" | "history";
  taskListQuery: string;
  listTimeRange: TimeRangeFilter;
  filteredTasks: TaskRow[];
  filteredHistory: HistoryItem[];
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  onSelectAssistantId: (assistantId: string) => void;
  onToggleRecordsExpanded: () => void;
  onToggleCollabExpanded: () => void;
  onSelectCollabTab: (tab: "delegations" | "timeline") => void;
  onSelectSideTab: (tab: "tasks" | "history") => void;
  onTaskListQueryChange: (value: string) => void;
  onListTimeRangeChange: (value: TimeRangeFilter) => void;
  onOpenDetail: (kind: "task" | "draft", id: string) => void | Promise<void>;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
};

export function LawmindSidebar({
  projectDir,
  assistants,
  selectedAssistantId,
  recordsExpanded,
  collabExpanded,
  collabTab,
  sideTab,
  taskListQuery,
  listTimeRange,
  filteredTasks,
  filteredHistory,
  delegations,
  collabEvents,
  onSelectAssistantId,
  onToggleRecordsExpanded,
  onToggleCollabExpanded,
  onSelectCollabTab,
  onSelectSideTab,
  onTaskListQueryChange,
  onListTimeRangeChange,
  onOpenDetail,
  formatRelativeTime,
  legalStatusLabel,
  taskBadgeClass,
  historyBadgeClass,
}: Props) {
  return (
    <div className="lm-side-scroll">
      {assistants.length > 1 && (
        <div className="lm-side-asst-row">
          <select
            className="lm-asst-select"
            value={selectedAssistantId}
            onChange={(e) => onSelectAssistantId(e.target.value)}
          >
            {assistants.map((assistant) => (
              <option key={assistant.assistantId} value={assistant.assistantId}>
                {assistant.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {projectDir && (
        <div className="lm-side-project-pill" title={`材料文件夹：${projectDir}`}>
          <span className="lm-side-project-icon">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3.88a1.5 1.5 0 0 1 1.06.44l.62.62a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </span>
          <span className="lm-side-project-name">
            {projectDir.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        </div>
      )}

      <button
        type="button"
        className="lm-section-toggle"
        onClick={onToggleRecordsExpanded}
        aria-expanded={recordsExpanded}
      >
        <span className={`lm-section-arrow ${recordsExpanded ? "lm-section-arrow-open" : ""}`}>›</span>
        <span className="lm-section-label">
          在办与记录
          <span className="lm-section-count">{filteredTasks.length + filteredHistory.length}</span>
        </span>
      </button>

      <button
        type="button"
        className="lm-section-toggle"
        onClick={onToggleCollabExpanded}
        aria-expanded={collabExpanded}
      >
        <span className={`lm-section-arrow ${collabExpanded ? "lm-section-arrow-open" : ""}`}>›</span>
        <span className="lm-section-label" title="多智能体派活与后台流程进度">
          协作
          <span className="lm-section-count">{countActiveDelegations(delegations)}</span>
        </span>
      </button>

      {collabExpanded && (
        <div className="lm-records-body">
          <div className="lm-tabs">
            <button
              type="button"
              className={`lm-tab ${collabTab === "delegations" ? "active" : ""}`}
              onClick={() => onSelectCollabTab("delegations")}
            >
              委派任务
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
                    <span className={`lm-badge ${
                      delegation.status === "completed" ? "lm-badge-done" :
                      delegation.status === "running" ? "lm-badge-running" :
                      delegation.status === "failed" || delegation.status === "timeout" ? "lm-badge-error" :
                      ""
                    }`}>
                      {delegation.status === "completed" ? "已完成" :
                        delegation.status === "running" ? "进行中" :
                        delegation.status === "failed" ? "失败" :
                        delegation.status === "timeout" ? "超时" :
                        delegation.status === "pending" ? "等待中" :
                        delegation.status === "cancelled" ? "已取消" : delegation.status}
                    </span>
                    <span className="lm-list-title">{delegation.task.slice(0, 80)}</span>
                  </div>
                  <div className="lm-list-time">
                    {delegation.fromAssistant} → {delegation.toAssistant}
                    {" · "}
                    {formatRelativeTime(delegation.startedAt)}
                  </div>
                  {delegation.error && (
                    <div className="lm-list-path lm-text-error">
                      {delegation.error}
                    </div>
                  )}
                  {delegation.result && (
                    <div className="lm-list-path">
                      {delegation.result.slice(0, 100)}{delegation.result.length > 100 ? "…" : ""}
                    </div>
                  )}
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
      )}

      {recordsExpanded && (
        <div className="lm-records-body">
          <div className="lm-sidebar-filters">
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
                      {task.matterId && <span className="lm-matter-badge">{task.matterId}</span>}
                    </div>
                    <div className="lm-list-time">{formatRelativeTime(task.updatedAt)}</div>
                    {task.outputPath && <div className="lm-list-path">{task.outputPath}</div>}
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
                    {item.matterId && <span className="lm-matter-badge">{item.matterId}</span>}
                  </div>
                  <div className="lm-list-time">{formatRelativeTime(item.updatedAt)}</div>
                  {item.outputPath && <div className="lm-list-path">{item.outputPath}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
