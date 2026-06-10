import { useState, type ReactNode } from "react";
import { countActiveDelegations } from "./lawmind-records-collab-panels";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsCollaboration } from "./LawmindSettingsCollaboration";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "./lawmind-app-data";
import {
  LawmindCollaborationComposeModelRail,
  type LawmindCollabComposeModelProps,
} from "./LawmindCollaborationComposeModelRail";
import { LawmindCollabDelegationCards } from "./LawmindCollabDelegationCards";
import { isSelectedModelVerified } from "./lawmind-model-verify";

export type CollaborationDeskTab = "overview" | "workflows";

type Props = {
  config: { apiBase: string } | null;
  collabSummarySettings: CollabSummaryState;
  selectedAssistantId: string;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  gateHistory: GateHistoryItem[];
  formatRelativeTime: (iso: string) => string;
  onRefreshCollaboration: () => void | Promise<void>;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  deskTab: CollaborationDeskTab;
  onDeskTabChange: (tab: CollaborationDeskTab) => void;
  composeModel?: LawmindCollabComposeModelProps | null;
  workflowModelLabel?: string;
  assistantDisplayById?: Record<string, string>;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
};

export function LawmindCollaborationDesk(props: Props): ReactNode {
  const {
    config,
    collabSummarySettings,
    selectedAssistantId,
    delegations,
    collabEvents,
    gateHistory,
    formatRelativeTime,
    onRefreshCollaboration,
    onOpenDelegationTargetChat,
    deskTab,
    onDeskTabChange,
    composeModel,
    workflowModelLabel,
    assistantDisplayById,
    onReconnectLocalService,
    localServiceReconnecting = false,
  } = props;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeDel = countActiveDelegations(delegations);

  const modelVerified =
    composeModel?.composeModelConfigured === true &&
    isSelectedModelVerified(composeModel.modelCatalog, composeModel.selectedModelId);

  return (
    <div className="lm-collab-desk">
      <header className="lm-collab-desk-header">
        <div className="lm-collab-desk-intro">
          <h1 className="lm-collab-desk-title">工作流</h1>
          <p className="lm-collab-desk-lead">
            查看进行中的委派与已完成结果；后台多步流程在「团队工作流」分栏排队执行。
          </p>
        </div>
        <nav className="lm-tabs lm-collab-desk-tabs" aria-label="工作流分区">
          <button
            type="button"
            className={`lm-tab ${deskTab === "overview" ? "active" : ""}`}
            aria-current={deskTab === "overview" ? "true" : undefined}
            onClick={() => onDeskTabChange("overview")}
          >
            状态一览
            {activeDel > 0 ? (
              <span className="lm-tab-inline-count" title="进行中的委派">
                {activeDel}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={`lm-tab ${deskTab === "workflows" ? "active" : ""}`}
            aria-current={deskTab === "workflows" ? "true" : undefined}
            onClick={() => onDeskTabChange("workflows")}
          >
            团队工作流
          </button>
        </nav>
      </header>

      {composeModel && !modelVerified ? <LawmindCollaborationComposeModelRail {...composeModel} /> : null}

      {deskTab === "overview" ? (
        <div className="lm-collab-desk-overview">
          <LawmindCollaborationStatusStrip
            collabSummarySettings={collabSummarySettings}
            activeDelegations={activeDel}
            onRefresh={() => void onRefreshCollaboration()}
          />
          <LawmindCollabDelegationCards
            delegations={delegations}
            assistantDisplayById={assistantDisplayById}
            formatRelativeTime={formatRelativeTime}
            onOpenDelegationTargetChat={onOpenDelegationTargetChat}
            onShowMore={() => setShowAdvanced(true)}
          />
          {showAdvanced ? (
            <section className="lm-collab-desk-advanced" aria-label="委派动态与门禁历史">
              <h2 className="lm-collab-desk-panel-heading">委派动态</h2>
              <ul className="lm-list lm-collab-events-compact">
                {collabEvents.length === 0 ? (
                  <li className="lm-list-empty">暂无委派动态</li>
                ) : (
                  [...collabEvents].toReversed().slice(0, 15).map((event) => (
                    <li key={event.eventId}>
                      <span className="lm-meta">{formatRelativeTime(event.timestamp)}</span>
                      <span>
                        {assistantDisplayById?.[event.fromAssistantId] ?? event.fromAssistantId} →{" "}
                        {assistantDisplayById?.[event.toAssistantId] ?? event.toAssistantId}
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <h2 className="lm-collab-desk-panel-heading">门禁历史</h2>
              <LawmindGateHistoryTimeline items={gateHistory} formatRelativeTime={formatRelativeTime} />
            </section>
          ) : null}
        </div>
      ) : (
        <div className="lm-collab-desk-workflows">
          {config ? (
            <LawmindSettingsCollaboration
              collabSummarySettings={collabSummarySettings}
              apiBase={config.apiBase}
              selectedAssistantId={selectedAssistantId}
              deskLayout="workflowsColumn"
              workflowAgentModelId={composeModel?.selectedModelId}
              workflowModelLabel={workflowModelLabel}
              onReconnectLocalService={onReconnectLocalService}
              localServiceReconnecting={localServiceReconnecting}
            />
          ) : (
            <div className="lm-callout lm-callout-warn lm-collab-desk-workflows-config" role="status">
              <p className="lm-callout-body">请先完成本地 API 与项目连接，再运行团队工作流。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function gateAuditSourceLabel(source: string): string {
  const map: Record<string, string> = {
    review: "审核签批",
    reopen_review: "恢复待审核",
    render: "渲染交付",
    render_blocked: "渲染被拦截",
    workflow_job: "团队工作流",
    agent_turn: "助手回合",
  };
  return map[source] ?? source;
}

function gateDecisionBadgeClass(decision: string): string {
  if (decision === "allow") {
    return "lm-badge lm-badge-done";
  }
  if (decision === "awaiting_confirmation") {
    return "lm-badge lm-badge-running";
  }
  return "lm-badge lm-badge-error";
}

function gateNameLabel(gate: string): string {
  const map: Record<string, string> = {
    clarification_gate: "澄清",
    dangerous_tool_gate: "危险工具",
    approval_gate: "审批",
    acceptance_gate: "出稿检查",
    reasoning_gate: "推理",
  };
  return map[gate] ?? gate;
}

function LawmindGateHistoryTimeline(props: {
  items: GateHistoryItem[];
  formatRelativeTime: (iso: string) => string;
}): ReactNode {
  const { items, formatRelativeTime } = props;
  if (items.length === 0) {
    return <p className="lm-meta lm-collab-gate-history-empty">暂无门禁历史。</p>;
  }
  return (
    <ul className="lm-list lm-collab-gate-history-list">
      {items.slice(0, 20).map((row) => (
        <li key={row.eventId} className="lm-collab-gate-history-row">
          <span className="lm-badge lm-badge-chat">{gateAuditSourceLabel(row.source)}</span>
          <time className="lm-collab-gate-history-time" dateTime={row.timestamp}>
            {formatRelativeTime(row.timestamp)}
          </time>
          {row.gateDecisions.length > 0 ? (
            <div className="lm-collab-gate-history-gates">
              {row.gateDecisions.map((gate, idx) => (
                <span
                  key={`${row.eventId}-${gate.gate}-${idx}`}
                  className={gateDecisionBadgeClass(gate.decision)}
                >
                  {gateNameLabel(gate.gate)}
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LawmindCollaborationStatusStrip(props: {
  collabSummarySettings: CollabSummaryState;
  activeDelegations: number;
  onRefresh: () => void;
}): ReactNode {
  const { collabSummarySettings, activeDelegations, onRefresh } = props;

  if (collabSummarySettings === undefined) {
    return (
      <div className="lm-collab-status-strip" aria-busy="true" aria-label="加载工作流状态">
        <div className="lm-shimmer lm-shimmer-line lm-collab-status-shimmer" />
      </div>
    );
  }

  if (collabSummarySettings === null) {
    return (
      <div className="lm-callout lm-callout-warn" role="status">
        <p className="lm-callout-body">无法加载工作流摘要，请检查本地服务连接。</p>
      </div>
    );
  }

  const enabled = collabSummarySettings.collaborationEnabled;
  return (
    <div className="lm-collab-status-strip" role="status">
      <span className={enabled ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
        {enabled ? "多助手工作流已开启" : "多助手工作流已关闭"}
      </span>
      {activeDelegations > 0 ? (
        <span className="lm-pill lm-pill-info">进行中 {activeDelegations}</span>
      ) : (
        <span className="lm-meta">当前无进行中的委派</span>
      )}
      <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onRefresh}>
        刷新
      </button>
    </div>
  );
}
