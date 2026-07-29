/**
 * 在办左栏：团队 / 队列 Tab + 目录列表。
 */
import type { ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import type { FleetTeamRow } from "./lawmind-fleet-team";
import { fleetTeamBusyLabel } from "./lawmind-fleet-team";
import {
  type FleetGroupKind,
  fleetStatusKind as statusKind,
  fleetStatusLabel as statusLabel,
  type FleetQueueGroup,
} from "./lawmind-fleet-queue";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";

export const FLEET_TAB_TEAM_ID = "lm-fleet-tab-team";
export const FLEET_TAB_QUEUE_ID = "lm-fleet-tab-queue";
export const FLEET_TABPANEL_TEAM_ID = "lm-fleet-tabpanel-team";
export const FLEET_TABPANEL_QUEUE_ID = "lm-fleet-tabpanel-queue";

export type LawmindAgentFleetListAsideProps = {
  matterScopedQueue: AgentRunSummary[];
  allQueue: AgentRunSummary[];
  queue: AgentRunSummary[];
  queueGroups: FleetQueueGroup[];
  teamRows: FleetTeamRow[];
  matterChoices: string[];
  matterFilter: string;
  onMatterFilterChange: (value: string) => void;
  listMode: "team" | "queue";
  onListModeChange: (mode: "team" | "queue") => void;
  assistantFilter: string | null;
  onSelectAssistant: (assistantId: string) => void;
  onSelectAllAssistants: () => void;
  selectedId: string | null;
  onSelectRun: (id: string) => void;
  expandedGroups: Set<FleetGroupKind>;
  onToggleGroup: (kind: FleetGroupKind) => void;
  pendingTeachCount: number;
  onOpenMemoryInspector?: () => void;
  needsDecisionFocus: boolean;
  onClearNeedsDecisionFocus?: () => void;
};

export function LawmindAgentFleetListAside(props: LawmindAgentFleetListAsideProps): ReactNode {
  const {
    matterScopedQueue,
    allQueue,
    queue,
    queueGroups,
    teamRows,
    matterChoices,
    matterFilter,
    onMatterFilterChange,
    listMode,
    onListModeChange,
    assistantFilter,
    onSelectAssistant,
    onSelectAllAssistants,
    selectedId,
    onSelectRun,
    expandedGroups,
    onToggleGroup,
    pendingTeachCount,
    onOpenMemoryInspector,
    needsDecisionFocus,
    onClearNeedsDecisionFocus,
  } = props;

  return (
    <aside className="lm-agents-wb-list" aria-label="在办团队目录">
      <div className="lm-agents-wb-list-toolbar">
        <span
          className="lm-agents-wb-pill"
          data-tone="warn"
          data-testid="lm-fleet-decision-focus-lead"
          title="当前筛选下待您拍板的事项数"
        >
          待拍板 {matterScopedQueue.length}
          {assistantFilter
            ? ` · 筛选 ${queue.length}`
            : matterFilter !== "all" && allQueue.length !== matterScopedQueue.length
              ? ` / 全所 ${allQueue.length}`
              : ""}
        </span>
        {matterChoices.length > 0 ? (
          <label className="lm-agents-wb-matter-filter">
            <span className="lm-sr-only">按案件筛选</span>
            <select
              className="lm-input lm-agents-wb-matter-select"
              data-testid="lm-fleet-matter-filter"
              value={matterFilter}
              onChange={(e) => onMatterFilterChange(e.target.value)}
            >
              <option value="all">全部案件</option>
              {matterChoices.map((mid) => (
                <option key={mid} value={mid}>
                  {mid}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {pendingTeachCount > 0 ? (
          onOpenMemoryInspector ? (
            <button
              type="button"
              className="lm-agents-wb-pill lm-agents-wb-pill-btn"
              data-tone="info"
              data-testid="lm-fleet-pending-teach"
              title="打开设置→记忆，确认团队学习建议"
              onClick={() => onOpenMemoryInspector()}
            >
              待教 {pendingTeachCount}
            </button>
          ) : (
            <span
              className="lm-agents-wb-pill"
              data-tone="info"
              data-testid="lm-fleet-pending-teach"
              title="记忆采纳队列中待确认的团队学习建议"
            >
              待教 {pendingTeachCount}
            </span>
          )
        ) : null}
        {needsDecisionFocus && onClearNeedsDecisionFocus ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-fleet-show-all"
            onClick={() => onClearNeedsDecisionFocus()}
          >
            退出聚焦
          </button>
        ) : null}
      </div>
      <div className="lm-agents-wb-list-modes" role="tablist" aria-label="目录视图">
        <button
          type="button"
          role="tab"
          id={FLEET_TAB_TEAM_ID}
          className="lm-agents-wb-list-mode"
          aria-selected={listMode === "team"}
          aria-controls={FLEET_TABPANEL_TEAM_ID}
          data-testid="lm-fleet-mode-team"
          onClick={() => onListModeChange("team")}
        >
          团队
        </button>
        <button
          type="button"
          role="tab"
          id={FLEET_TAB_QUEUE_ID}
          className="lm-agents-wb-list-mode"
          aria-selected={listMode === "queue"}
          aria-controls={FLEET_TABPANEL_QUEUE_ID}
          data-testid="lm-fleet-mode-queue"
          onClick={() => onListModeChange("queue")}
        >
          队列
        </button>
      </div>
      <div
        className="lm-agents-wb-list-scroll"
        role="tabpanel"
        id={listMode === "team" ? FLEET_TABPANEL_TEAM_ID : FLEET_TABPANEL_QUEUE_ID}
        aria-labelledby={listMode === "team" ? FLEET_TAB_TEAM_ID : FLEET_TAB_QUEUE_ID}
      >
        {listMode === "team" ? (
          <>
            <button
              type="button"
              className="lm-agents-wb-team-row lm-agents-wb-team-row--all"
              data-testid="lm-fleet-team-all"
              aria-selected={assistantFilter === null}
              onClick={() => onSelectAllAssistants()}
            >
              <span className="lm-agents-wb-team-name">全部成员</span>
              <span className="lm-agents-wb-team-meta">待拍板 {matterScopedQueue.length}</span>
            </button>
            {teamRows.map((row) => {
              const selected = assistantFilter === row.assistantId;
              const pass =
                row.windowTasksReviewed &&
                row.windowTasksReviewed > 0 &&
                row.windowFirstPassRate != null
                  ? `${Math.round(row.windowFirstPassRate * 100)}%`
                  : null;
              return (
                <button
                  key={row.assistantId}
                  type="button"
                  className="lm-agents-wb-team-row"
                  data-busy={row.busy}
                  data-testid={`lm-fleet-team-${row.assistantId}`}
                  aria-selected={selected}
                  onClick={() => onSelectAssistant(row.assistantId)}
                >
                  <span className="lm-agents-wb-team-name">{row.displayName}</span>
                  <span className="lm-agents-wb-team-status" data-busy={row.busy}>
                    {fleetTeamBusyLabel(row.busy)}
                    {row.awaitingCount > 0 ? ` ${row.awaitingCount}` : ""}
                  </span>
                  <span className="lm-agents-wb-team-meta">
                    {pass ? `近30日一次过 ${pass}` : (row.roleId ?? "—")}
                    {typeof row.avgRewriteAbsChars === "number"
                      ? ` · 均改写 ~${row.avgRewriteAbsChars} 字`
                      : ""}
                    {row.pendingAdoptions > 0 ? ` · 待教 ${row.pendingAdoptions}` : ""}
                  </span>
                  {row.currentTitle ? (
                    <span className="lm-agents-wb-team-title">
                      {sanitizeLawyerFacingText(row.currentTitle).slice(0, 48)}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {assistantFilter && queue.length > 0 ? (
              <div className="lm-agents-wb-team-drill" data-testid="lm-fleet-team-drill">
                <div className="lm-agents-wb-team-drill-label">该成员待办</div>
                {queue.map((run) => {
                  const kind = statusKind(run.status);
                  const rowTitle = sanitizeLawyerFacingText(run.title, run.toolName)
                    .replace(/^待审定：\s*/, "")
                    .replace(/^待批准：\s*/, "");
                  return (
                    <button
                      key={run.id}
                      type="button"
                      className="lm-agents-wb-row"
                      data-kind={kind}
                      data-fleet-run-id={run.id}
                      aria-selected={run.id === selectedId}
                      data-testid={`lm-agent-fleet-card-${run.kind}`}
                      onClick={() => onSelectRun(run.id)}
                    >
                      <span className="lm-agents-wb-row-kind" data-kind={kind}>
                        {statusLabel(run.status).replace(/^待/, "")}
                      </span>
                      <span className="lm-agents-wb-row-body">
                        <span className="lm-agents-wb-row-title">{rowTitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          queueGroups.map((group) => {
            const expanded = expandedGroups.has(group.kind);
            const panelId = `lm-fleet-group-panel-${group.kind}`;
            return (
              <div
                key={group.kind}
                className={`lm-agents-wb-group${expanded ? " lm-agents-wb-group--open" : ""}`}
                data-kind={group.kind}
                data-testid={`lm-fleet-group-${group.kind}`}
              >
                <button
                  type="button"
                  className="lm-agents-wb-group-toggle"
                  data-kind={group.kind}
                  data-testid={`lm-fleet-group-toggle-${group.kind}`}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  title={expanded ? `收起${group.label}` : `展开${group.label}`}
                  onClick={() => onToggleGroup(group.kind)}
                >
                  <span className="lm-agents-wb-group-label-text">{group.label}</span>
                  <span
                    className="lm-agents-wb-group-count"
                    aria-label={`${group.items.length} 件`}
                  >
                    {group.items.length}
                  </span>
                  <span className="lm-agents-wb-group-chevron" aria-hidden />
                </button>
                {expanded ? (
                  <div
                    id={panelId}
                    className="lm-agents-wb-group-panel"
                    role="region"
                    aria-label={group.label}
                  >
                    {group.items.map((run) => {
                      const kind = statusKind(run.status);
                      const rowTitle = sanitizeLawyerFacingText(run.title, run.toolName)
                        .replace(/^待审定：\s*/, "")
                        .replace(/^待批准：\s*/, "");
                      const matterLine = run.matterId?.trim();
                      return (
                        <button
                          key={run.id}
                          type="button"
                          className="lm-agents-wb-row"
                          data-kind={kind}
                          data-fleet-run-id={run.id}
                          aria-selected={run.id === selectedId}
                          aria-label={`${statusLabel(run.status)} ${rowTitle}`}
                          data-testid={`lm-agent-fleet-card-${run.kind}`}
                          onClick={() => onSelectRun(run.id)}
                        >
                          <span className="lm-agents-wb-row-kind" data-kind={kind}>
                            {statusLabel(run.status).replace(/^待/, "")}
                          </span>
                          <span className="lm-agents-wb-row-body">
                            <span className="lm-agents-wb-row-title">{rowTitle}</span>
                            {matterLine && !matterLine.startsWith("临时") ? (
                              <span className="lm-agents-wb-row-matter">{matterLine}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
