import React from "react";
import { LawmindCollaborationDesk, type CollaborationDeskTab } from "../LawmindCollaborationDesk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type { ModelCatalogEntry } from "../lawmind-models-api";

export type CollaborationViewProps = {
  config: AppConfig | null;
  collabSummarySettings: CollabSummaryState | null;
  selectedAssistantId: string;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  gateHistory: GateHistoryItem[];
  formatRelativeTime: (iso: string) => string;
  onRefreshCollaboration: () => void;
  onOpenDelegationTargetChat: (d: DelegationRow) => void;
  collaborationDeskTab: CollaborationDeskTab;
  onDeskTabChange: (tab: CollaborationDeskTab) => void;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect: (id: string) => void;
  onOpenComposeSettings: () => void;
  onOpenApiWizard: () => void;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  onComposeModelQuickTest: () => void;
  healthModelConfigured: boolean | undefined;
  chatLoading: boolean;
  workflowModelLabel: string;
  assistantDisplayById: Record<string, string>;
  onReconnectLocalService: () => void;
  localServiceReconnecting: boolean;
};

function CollaborationViewImpl(props: CollaborationViewProps) {
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

  return (
    <div className="lm-main-workbench lm-desk-page lm-desk-page-collab">
      <div className="lm-side-scroll lm-desk-page-scroll lm-collab-page-stack">
        <LawmindCollaborationDesk
          config={props.config}
          collabSummarySettings={props.collabSummarySettings}
          selectedAssistantId={props.selectedAssistantId}
          delegations={props.delegations}
          collabEvents={props.collabEvents}
          gateHistory={props.gateHistory}
          formatRelativeTime={props.formatRelativeTime}
          onRefreshCollaboration={props.onRefreshCollaboration}
          onOpenDelegationTargetChat={(d) => props.onOpenDelegationTargetChat(d)}
          deskTab={props.collaborationDeskTab}
          onDeskTabChange={props.onDeskTabChange}
          composeModel={composeModel}
          workflowModelLabel={props.workflowModelLabel}
          assistantDisplayById={props.assistantDisplayById}
          onReconnectLocalService={props.onReconnectLocalService}
          localServiceReconnecting={props.localServiceReconnecting}
        />
      </div>
    </div>
  );
}

export const CollaborationView = React.memo(CollaborationViewImpl);
