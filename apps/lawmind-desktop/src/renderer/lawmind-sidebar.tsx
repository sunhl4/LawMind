import type { CollabEvent, DelegationRow, HistoryItem, TaskRow } from "./lawmind-app-data";

import type { TimeRangeFilter } from "./lawmind-time-range";
import {
  LawmindCollabPanel,
  LawmindRecordsPanel,
  countActiveDelegations,
} from "./lawmind-records-collab-panels";

export type { TimeRangeFilter } from "./lawmind-time-range";
export { countActiveDelegations };

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
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
  /** 为 false 时不在侧栏显示助手下拉（改由主栏标题区展示） */
  showAssistantSelector?: boolean;
  /** project-only：仅材料目录等，在办/协作改由顶栏进入整页 */
  variant?: "full" | "project-only";
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
  onOpenDelegationTargetChat,
  formatRelativeTime,
  legalStatusLabel,
  taskBadgeClass,
  historyBadgeClass,
  showAssistantSelector = true,
  variant = "full",
}: Props) {
  return (
    <div className="lm-side-scroll">
      {showAssistantSelector && assistants.length > 1 && (
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

      {variant === "project-only" ? null : (
        <>
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
            <span className="lm-section-label" title="委派任务与后台工作流进度">
              工作流
              <span className="lm-section-count">{countActiveDelegations(delegations)}</span>
            </span>
          </button>

          {collabExpanded ? (
            <LawmindCollabPanel
              collabTab={collabTab}
              delegations={delegations}
              collabEvents={collabEvents}
              onSelectCollabTab={onSelectCollabTab}
              formatRelativeTime={formatRelativeTime}
              onOpenDelegationTargetChat={onOpenDelegationTargetChat}
            />
          ) : null}

          {recordsExpanded ? (
            <LawmindRecordsPanel
              sideTab={sideTab}
              taskListQuery={taskListQuery}
              listTimeRange={listTimeRange}
              filteredTasks={filteredTasks}
              filteredHistory={filteredHistory}
              onSelectSideTab={onSelectSideTab}
              onTaskListQueryChange={onTaskListQueryChange}
              onListTimeRangeChange={onListTimeRangeChange}
              onOpenDetail={onOpenDetail}
              formatRelativeTime={formatRelativeTime}
              legalStatusLabel={legalStatusLabel}
              taskBadgeClass={taskBadgeClass}
              historyBadgeClass={historyBadgeClass}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
