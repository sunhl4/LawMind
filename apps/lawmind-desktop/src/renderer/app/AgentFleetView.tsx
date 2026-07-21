import React from "react";
import { LawmindAgentFleetPanel } from "../LawmindAgentFleetPanel";
import { LawmindCollaborationDesk } from "../LawmindCollaborationDesk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type { AgentsDeskTab } from "../lawmind-agents-desk";
import type { LawMindRequiresAction } from "../lawmind-requires-action";
import type { AgentPreset } from "../lawmind-agent-fleet-api";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import { isSelectedModelVerified } from "../lawmind-model-verify";
import { LawmindCollaborationComposeModelRail } from "../LawmindCollaborationComposeModelRail";

export type AgentFleetViewProps = {
  config: AppConfig | null;
  matterId?: string | null;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  canDelegate: boolean;
  onRefreshActionSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onNewChat: () => void;
  onOpenAgentsWorkflows?: () => void;
  onOpenWorkflowLibrary?: () => void;
  onDelegate: () => void;
  onSpawnPreset: (preset: AgentPreset) => void;
  onOpenDelegations?: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview: (taskId?: string, matterId?: string) => void;
  agentsDeskTab: AgentsDeskTab;
  onAgentsDeskTabChange: (tab: AgentsDeskTab) => void;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
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

function AgentFleetViewImpl(props: AgentFleetViewProps) {
  const onActive = props.agentsDeskTab === "active";

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
        {!onActive ? (
          <header className="lm-agents-wb-bar">
            <h1>{props.agentsDeskTab === "workflows" ? "按流程" : "交出去的"}</h1>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-agents-tab-active"
              onClick={() => props.onAgentsDeskTabChange("active")}
            >
              返回在办
            </button>
          </header>
        ) : null}

        {composeModel && !modelVerified && !onActive ? (
          <LawmindCollaborationComposeModelRail {...composeModel} />
        ) : null}

        {onActive && props.config?.apiBase ? (
          <LawmindAgentFleetPanel
            apiBase={props.config.apiBase}
            matterId={props.matterId}
            sessionId={props.sessionId}
            sessionRequiresActions={props.sessionRequiresActions}
            assistantDisplayById={props.assistantDisplayById}
            canDelegate={props.canDelegate}
            needsDecisionFocus={props.needsDecisionFocus}
            onClearNeedsDecisionFocus={props.onClearNeedsDecisionFocus}
            onRefreshSummary={props.onRefreshActionSummary}
            onChatResumeComplete={props.onChatResumeComplete}
            onNewChat={props.onNewChat}
            onOpenAgentsWorkflows={props.onOpenAgentsWorkflows ?? props.onOpenWorkflowLibrary}
            onDelegate={props.onDelegate}
            onSpawnPreset={props.onSpawnPreset}
            onOpenCollaboration={props.onOpenDelegations}
            onOpenChatSession={props.onOpenChatSession}
            onOpenReview={props.onOpenReview}
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
