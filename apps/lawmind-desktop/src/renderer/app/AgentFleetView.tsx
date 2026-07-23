import React from "react";
import { LawmindAgentFleetPanel } from "../LawmindAgentFleetPanel";
import { LawmindCollaborationDesk } from "../LawmindCollaborationDesk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type { AgentsDeskTab, NeedsDecisionDeskTarget } from "../lawmind-agents-desk";
import { countActiveDelegations } from "../lawmind-records-collab-panels";
import type { LawMindRequiresAction } from "../lawmind-requires-action";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import { isSelectedModelVerified } from "../lawmind-model-verify";
import { LawmindCollaborationComposeModelRail } from "../LawmindCollaborationComposeModelRail";

export type AgentFleetViewProps = {
  config: AppConfig | null;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  onRefreshActionSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview: (taskId?: string, matterId?: string) => void;
  onShowArtifact?: (outputPath: string) => void;
  onOpenMemoryInspector?: () => void;
  agentsDeskTab: AgentsDeskTab;
  onAgentsDeskTabChange: (tab: AgentsDeskTab) => void;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  focusTarget?: NeedsDecisionDeskTarget | null;
  onFocusTargetConsumed?: () => void;
  collabSummarySettings: CollabSummaryState | null | undefined;
  selectedAssistantId: string;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  gateHistory: GateHistoryItem[];
  formatRelativeTime: (iso: string) => string;
  onRefreshCollaboration: () => void | Promise<void>;
  onOpenDelegationTargetChat: (d: DelegationRow) => void | Promise<void>;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect: (id: string) => void;
  onOpenComposeSettings: () => void;
  onOpenApiWizard: () => void;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  onComposeModelQuickTest: () => void | Promise<void>;
  healthModelConfigured: boolean | undefined;
  chatLoading: boolean;
  workflowModelLabel: string;
  onReconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
};

function deskTabTitle(tab: AgentsDeskTab): string {
  switch (tab) {
    case "workflows":
      return "按流程办";
    case "delegations":
      return "交出去的活";
    default:
      return "待拍板";
  }
}

function AgentFleetViewImpl(props: AgentFleetViewProps) {
  const onActive = props.agentsDeskTab === "active";
  const activeDel = countActiveDelegations(props.delegations);

  const composeModel =
    props.config?.apiBase
      ? {
          modelCatalog: props.modelCatalog,
          selectedModelId: props.selectedModelId,
          onModelSelect: props.onModelSelect,
          onOpenComposeSettings: props.onOpenComposeSettings,
          onOpenApiWizard: props.onOpenApiWizard,
          onComposeModelQuickTest: props.onComposeModelQuickTest,
          composeModelHint: props.composeModelHint,
          composeModelQuickTestBusy: props.composeModelQuickTestBusy,
          composeModelConfigured: props.healthModelConfigured,
          chatLoading: props.chatLoading,
        }
      : null;

  const modelVerified =
    composeModel?.composeModelConfigured === true &&
    isSelectedModelVerified(composeModel.modelCatalog, composeModel.selectedModelId);

  if (!props.config?.apiBase && onActive) {
    return (
      <div className="lm-desk-page lm-agent-fleet-page lm-agents-desk-page">
        <p className="lm-meta">本地服务未就绪。</p>
      </div>
    );
  }

  return (
    <div
      className="lm-main-workbench lm-desk-page lm-agent-fleet-page lm-agents-desk-page"
      data-testid="lm-agents-desk"
    >
      <div className="lm-side-scroll lm-desk-page-scroll lm-agents-desk-stack">
        <header className="lm-agents-wb-bar" data-testid="lm-agents-desk-chrome">
          <div className="lm-agents-wb-bar-meta">
            <h1>在办</h1>
            <span className="lm-meta lm-agents-desk-chrome-sub" aria-live="polite">
              {deskTabTitle(props.agentsDeskTab)}
            </span>
          </div>
          <nav className="lm-tabs lm-agents-desk-tabs" aria-label="在办分区">
            <button
              type="button"
              className={`lm-tab ${props.agentsDeskTab === "active" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "active" ? "page" : undefined}
              data-testid="lm-agents-tab-active"
              onClick={() => props.onAgentsDeskTabChange("active")}
              title="谁在忙、待签批 / 补充 / 批准"
            >
              待拍板
            </button>
            <button
              type="button"
              className={`lm-tab ${props.agentsDeskTab === "delegations" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "delegations" ? "page" : undefined}
              data-testid="lm-agents-tab-delegations"
              onClick={() => props.onAgentsDeskTabChange("delegations")}
              title="已交办给助手的事项进度"
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
              className={`lm-tab ${props.agentsDeskTab === "workflows" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "workflows" ? "page" : undefined}
              data-testid="lm-agents-tab-workflows"
              onClick={() => props.onAgentsDeskTabChange("workflows")}
              title="按模板跑多步团队流程"
            >
              按流程办
            </button>
          </nav>
        </header>

        {composeModel && !modelVerified && !onActive ? (
          <LawmindCollaborationComposeModelRail {...composeModel} />
        ) : null}

        {onActive && props.config?.apiBase ? (
          <LawmindAgentFleetPanel
            apiBase={props.config.apiBase}
            workspaceDir={props.config.workspaceDir}
            sessionId={props.sessionId}
            sessionRequiresActions={props.sessionRequiresActions}
            assistantDisplayById={props.assistantDisplayById}
            selectedAssistantId={props.selectedAssistantId}
            needsDecisionFocus={props.needsDecisionFocus}
            onClearNeedsDecisionFocus={props.onClearNeedsDecisionFocus}
            focusTarget={props.focusTarget}
            onFocusTargetConsumed={props.onFocusTargetConsumed}
            onRefreshSummary={props.onRefreshActionSummary}
            onChatResumeComplete={props.onChatResumeComplete}
            onOpenChatSession={props.onOpenChatSession}
            onOpenReview={props.onOpenReview}
            onShowArtifact={props.onShowArtifact}
            onOpenMemoryInspector={props.onOpenMemoryInspector}
          />
        ) : null}

        {props.agentsDeskTab === "delegations" || props.agentsDeskTab === "workflows" ? (
          <LawmindCollaborationDesk
            config={props.config}
            collabSummarySettings={props.collabSummarySettings ?? null}
            selectedAssistantId={props.selectedAssistantId}
            delegations={props.delegations}
            collabEvents={props.collabEvents}
            gateHistory={props.gateHistory}
            formatRelativeTime={props.formatRelativeTime}
            onRefreshCollaboration={props.onRefreshCollaboration}
            onOpenDelegationTargetChat={props.onOpenDelegationTargetChat}
            deskTab={props.agentsDeskTab === "workflows" ? "workflows" : "overview"}
            onDeskTabChange={(tab) =>
              props.onAgentsDeskTabChange(tab === "workflows" ? "workflows" : "delegations")
            }
            composeModel={null}
            workflowModelLabel={props.workflowModelLabel}
            assistantDisplayById={props.assistantDisplayById}
            onReconnectLocalService={props.onReconnectLocalService}
            localServiceReconnecting={props.localServiceReconnecting}
            embedded
          />
        ) : null}
      </div>
    </div>
  );
}

export const AgentFleetView = React.memo(AgentFleetViewImpl);
