import React from "react";
import { LawmindAgentFleetPanel } from "../LawmindAgentFleetPanel";
import { LawmindCollaborationDesk } from "../LawmindCollaborationDesk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type {
  AgentsDeskTab,
  AgentsWorkflowFocusTarget,
  NeedsDecisionDeskTarget,
} from "../lawmind-agents-desk";
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
  onOpenDoctor?: () => void;
  agentsDeskTab: AgentsDeskTab;
  onAgentsDeskTabChange: (tab: AgentsDeskTab) => void;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  focusTarget?: NeedsDecisionDeskTarget | null;
  onFocusTargetConsumed?: () => void;
  workflowFocus?: AgentsWorkflowFocusTarget | null;
  onWorkflowFocusConsumed?: () => void;
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
  onOpenMatterOnDesk?: (matterId: string) => void;
};

function AgentFleetViewImpl(props: AgentFleetViewProps) {
  const onActive = props.agentsDeskTab === "active";
  const activeDel = countActiveDelegations(props.delegations);
  const sectionLabel =
    props.agentsDeskTab === "delegations"
      ? "交出去的活"
      : props.agentsDeskTab === "workflows"
        ? "按流程办"
        : null;

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
            {sectionLabel ? <p className="lm-agents-desk-chrome-sub">{sectionLabel}</p> : null}
          </div>
          <nav className="lm-tabs lm-agents-desk-tabs" aria-label="在办分区">
            {sectionLabel ? (
              <button
                type="button"
                className="lm-tab"
                data-testid="lm-agents-tab-active"
                onClick={() => props.onAgentsDeskTabChange("active")}
              >
                回到列表
              </button>
            ) : null}
            <button
              type="button"
              className="lm-tab lm-tab-secondary"
              data-testid="lm-agents-open-review"
              title="打开已出的稿，自行改或再吩咐一轮"
              onClick={() => props.onOpenReview()}
            >
              改稿
            </button>
            <details className="lm-agents-desk-more" data-testid="lm-agents-desk-more">
              <summary className="lm-tab lm-tab-secondary">更多</summary>
              <div className="lm-agents-desk-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="lm-agents-desk-more-item"
                  data-testid="lm-agents-tab-delegations"
                  aria-current={props.agentsDeskTab === "delegations" ? "page" : undefined}
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    props.onAgentsDeskTabChange("delegations");
                  }}
                >
                  交出去的活
                  {activeDel > 0 ? ` ${activeDel}` : ""}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="lm-agents-desk-more-item"
                  data-testid="lm-agents-tab-workflows"
                  aria-current={props.agentsDeskTab === "workflows" ? "page" : undefined}
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    props.onAgentsDeskTabChange("workflows");
                  }}
                >
                  按流程办
                </button>
              </div>
            </details>
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
            onOpenHealth={props.onOpenDoctor}
            onOpenMatterOnDesk={props.onOpenMatterOnDesk}
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
            workflowFocus={props.workflowFocus}
            onWorkflowFocusConsumed={props.onWorkflowFocusConsumed}
            embedded
          />
        ) : null}
      </div>
    </div>
  );
}

export const AgentFleetView = React.memo(AgentFleetViewImpl);
