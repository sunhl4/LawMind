import { useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "./api-client";
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
import type { AgentsWorkflowFocusTarget, CollaborationDeskTab } from "./lawmind-agents-desk";

export type { CollaborationDeskTab } from "./lawmind-agents-desk";

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
  /** 交办结果「查看流程」深链。 */
  workflowFocus?: AgentsWorkflowFocusTarget | null;
  onWorkflowFocusConsumed?: () => void;
  /** When true, chrome (title + tabs) is owned by「在办」parent. */
  embedded?: boolean;
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
    workflowFocus = null,
    onWorkflowFocusConsumed,
    embedded = false,
  } = props;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [cancelHint, setCancelHint] = useState<string | null>(null);
  const activeDel = countActiveDelegations(delegations);

  const modelVerified =
    composeModel?.composeModelConfigured === true &&
    isSelectedModelVerified(composeModel.modelCatalog, composeModel.selectedModelId);

  const handleCancelDelegation = async (d: DelegationRow) => {
    if (!config?.apiBase) {
      setCancelHint("本地服务未就绪，无法撤销委派。");
      return;
    }
    setCancelBusyId(d.delegationId);
    setCancelHint(null);
    try {
      await apiSendJson(config.apiBase, `/api/delegations/${encodeURIComponent(d.delegationId)}`, "DELETE");
      setCancelHint("已撤销委派。");
      await onRefreshCollaboration();
    } catch (e) {
      setCancelHint(errorMessage(e, "撤销委派失败"));
    } finally {
      setCancelBusyId(null);
    }
  };

  return (
    <div className={`lm-collab-desk${embedded ? " lm-collab-desk-embedded" : ""}`}>
      {!embedded ? (
        <header className="lm-collab-desk-header">
          <div className="lm-collab-desk-intro">
            <h1 className="lm-collab-desk-title">交出去的活</h1>
          </div>
          <nav className="lm-tabs lm-collab-desk-tabs" aria-label="在办分区">
            <button
              type="button"
              className={`lm-tab ${deskTab === "overview" ? "active" : ""}`}
              aria-current={deskTab === "overview" ? "true" : undefined}
              onClick={() => onDeskTabChange("overview")}
            >
              交出去的活
              {activeDel > 0 ? (
                <span className="lm-tab-inline-count" title="进行中的交办">
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
              按流程办
            </button>
          </nav>
        </header>
      ) : null}

      {!embedded && composeModel && !modelVerified ? (
        <LawmindCollaborationComposeModelRail {...composeModel} />
      ) : null}

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
            onCancelDelegation={(d) => void handleCancelDelegation(d)}
            cancelBusyId={cancelBusyId}
            onShowMore={() => setShowAdvanced(true)}
          />
          {cancelHint ? (
            <p className="lm-meta lm-collab-cancel-hint" role="status">
              {cancelHint}
            </p>
          ) : null}
          {showAdvanced ? (
            <section className="lm-collab-desk-advanced" aria-label="交办动态与审批记录">
              <h2 className="lm-collab-desk-panel-heading">交办动态</h2>
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
              <h2 className="lm-collab-desk-panel-heading">审批与拦截记录</h2>
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
              workflowFocus={workflowFocus}
              onWorkflowFocusConsumed={onWorkflowFocusConsumed}
            />
          ) : (
            <div className="lm-callout lm-callout-warn lm-collab-desk-workflows-config" role="status">
              <p className="lm-callout-body">请先连接。</p>
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
    render: "生成正式稿",
    render_blocked: "生成被拦下",
    workflow_job: "团队流程",
    agent_turn: "助手处理",
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
    intake_gate: "交办问清",
    dangerous_tool_gate: "需确认操作",
    approval_gate: "审批",
    acceptance_gate: "出稿检查",
    reasoning_gate: "依据检查",
    redline_hunks_gate: "空修订",
    citation_integrity_gate: "引用核对",
    outbound_privilege_gate: "特权确认",
    outbound_recipient_gate: "收件人确认",
  };
  return map[gate] ?? gate;
}

function LawmindGateHistoryTimeline(props: {
  items: GateHistoryItem[];
  formatRelativeTime: (iso: string) => string;
}): ReactNode {
  const { items, formatRelativeTime } = props;
  if (items.length === 0) {
    return <p className="lm-meta lm-collab-gate-history-empty">暂无审批与拦截记录。</p>;
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
                    title={
                    gate.category === "judgment_soft"
                      ? "判断类"
                      : gate.category === "safety_hard"
                        ? "安全类"
                        : undefined
                  }
                  data-gate-category={gate.category ?? undefined}
                >
                  {gateNameLabel(gate.gate)}
                  {gate.category === "judgment_soft"
                    ? " · 软"
                    : gate.category === "safety_hard"
                      ? " · 硬"
                      : ""}
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
      {!enabled ? (
        <span className="lm-pill lm-pill-warn" title="可在设置中开启多助手交办">
          交办功能未开启
        </span>
      ) : null}
      {activeDelegations > 0 ? (
        <span className="lm-meta">进行中 {activeDelegations} 件</span>
      ) : (
        <span className="lm-meta">当前没有进行中的交办</span>
      )}
      <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onRefresh}>
        刷新
      </button>
    </div>
  );
}
