import React, { useMemo } from "react";
import { LawmindAgentFleetPanel } from "../LawmindAgentFleetPanel";
import { LawmindCollaborationDesk } from "../LawmindCollaborationDesk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type { AgentsDeskTab } from "../lawmind-agents-desk";
import { countActiveDelegations } from "../lawmind-records-collab-panels";
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
  /** Jump to「按流程办」within 在办 (monitor/start console). Prefer chat templates for intake. */
  onOpenAgentsWorkflows?: () => void;
  /** @deprecated Use onOpenAgentsWorkflows */
  onOpenWorkflowLibrary?: () => void;
  onDelegate: () => void;
  onSpawnPreset: (preset: AgentPreset) => void;
  onOpenDelegations?: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview: (taskId: string) => void;
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
  const activeDel = useMemo(() => countActiveDelegations(props.delegations), [props.delegations]);

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

  if (!props.config?.apiBase && props.agentsDeskTab === "active") {
    return (
      <div className="lm-desk-page lm-agent-fleet-page">
        <p className="lm-meta">本地服务未就绪，无法加载在办事项。</p>
      </div>
    );
  }

  return (
    <div className="lm-main-workbench lm-desk-page lm-agent-fleet-page" data-testid="lm-agents-desk">
      <div className="lm-side-scroll lm-desk-page-scroll lm-agents-desk-stack">
        <header className="lm-agents-desk-header">
          <div className="lm-agents-desk-intro">
            <h1 className="lm-agents-desk-title">
              {props.needsDecisionFocus && props.agentsDeskTab === "active" ? "待我拍板" : "在办"}
            </h1>
            <p className="lm-agents-desk-lead">
              {props.needsDecisionFocus && props.agentsDeskTab === "active"
                ? "只看待决：澄清、批准与待审文书。可「显示全部」回到进行中。"
                : "跟进进度、处理待拍板；新任务请回「对话」下达。"}
            </p>
          </div>
          <nav className="lm-tabs lm-agents-desk-tabs" aria-label="在办分区">
            <button
              type="button"
              className={`lm-tab ${props.agentsDeskTab === "active" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "active" ? "true" : undefined}
              data-testid="lm-agents-tab-active"
              onClick={() => props.onAgentsDeskTabChange("active")}
            >
              进行中
            </button>
            <button
              type="button"
              className={`lm-tab ${props.agentsDeskTab === "delegations" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "delegations" ? "true" : undefined}
              data-testid="lm-agents-tab-delegations"
              onClick={() => {
                props.onClearNeedsDecisionFocus?.();
                props.onAgentsDeskTabChange("delegations");
              }}
            >
              交出去的活
              {activeDel > 0 ? (
                <span className="lm-tab-inline-count" title="进行中的委派">
                  {activeDel}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`lm-tab ${props.agentsDeskTab === "workflows" ? "active" : ""}`}
              aria-current={props.agentsDeskTab === "workflows" ? "true" : undefined}
              data-testid="lm-agents-tab-workflows"
              onClick={() => {
                props.onClearNeedsDecisionFocus?.();
                props.onAgentsDeskTabChange("workflows");
              }}
            >
              按流程办
            </button>
          </nav>
        </header>

        {composeModel && !modelVerified && props.agentsDeskTab !== "active" ? (
          <LawmindCollaborationComposeModelRail {...composeModel} />
        ) : null}

        {props.agentsDeskTab === "active" && props.config?.apiBase ? (
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
