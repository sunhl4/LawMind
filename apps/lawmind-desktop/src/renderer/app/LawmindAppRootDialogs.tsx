import React from "react";
import { LawmindCreateMatterDialog } from "../LawmindCreateMatterDialog";
import { LawmindMatterRenameDialog, LawmindMatterDeleteDialog } from "../LawmindMatterRenameDeleteDialogs";
import { LawmindDelegateAssistDialog } from "../LawmindDelegateAssistDialog";
import { LawmindActionHub } from "../LawmindActionHub";
import { LawmindTaskDrawer } from "../LawmindTaskDrawer";
import { LawmindToolApprovalDialog } from "../LawmindToolApprovalDialog";
import type { DelegationRow } from "../lawmind-app-data";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type {
  LawMindRequiresAction,
  LawMindRequiresActionDecision,
} from "../lawmind-requires-action";

export type LawmindAppRootDialogsProps = {
  apiBase: string | undefined;
  delegateAssistOpen: boolean;
  onCloseDelegateAssist: () => void;
  selectedAssistantId: string;
  activeChatSessionId: string | null;
  contextMatterId: string | null;
  delegateTaskDefault: string;
  assistants: AssistantRow[];
  delegations: DelegationRow[];
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onDelegated: (opts: { toDisplayName: string }) => void;
  createMatterOpen: boolean;
  onCloseCreateMatter: () => void;
  onCreateMatterSuccess: (matterId: string) => void;
  matterRenameOpen: { matterId: string; initialTitle: string } | null;
  onCloseMatterRename: () => void;
  onMatterRenameSuccess: () => void;
  matterDeleteOpen: { matterId: string; label: string } | null;
  onCloseMatterDelete: () => void;
  onMatterDeleteSuccess: (matterId: string) => void;
  onMatterListChanged: () => void;
  showActionHub: boolean;
  onCloseActionHub: () => void;
  onRefreshActionSummary: () => void | Promise<void>;
  sessionRequiresActions: LawMindRequiresAction[];
  sessionId: string | null | undefined;
  onChatResumeComplete: () => void | Promise<void>;
  taskDrawerOpen: boolean;
  onCloseTaskDrawer: () => void;
  toolApprovalDialogAction: LawMindRequiresAction | null;
  loading: boolean;
  onCloseToolApproval: () => void;
  onResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
    opts?: { skipApprovalDialog?: boolean },
  ) => void | Promise<void>;
};

function LawmindAppRootDialogsImpl({
  apiBase,
  delegateAssistOpen,
  onCloseDelegateAssist,
  selectedAssistantId,
  activeChatSessionId,
  contextMatterId,
  delegateTaskDefault,
  assistants,
  delegations,
  modelCatalog,
  selectedModelId,
  onDelegated,
  createMatterOpen,
  onCloseCreateMatter,
  onCreateMatterSuccess,
  matterRenameOpen,
  onCloseMatterRename,
  onMatterRenameSuccess,
  matterDeleteOpen,
  onCloseMatterDelete,
  onMatterDeleteSuccess,
  onMatterListChanged,
  showActionHub,
  onCloseActionHub,
  onRefreshActionSummary,
  sessionRequiresActions,
  sessionId,
  onChatResumeComplete,
  taskDrawerOpen,
  onCloseTaskDrawer,
  toolApprovalDialogAction,
  loading,
  onCloseToolApproval,
  onResumeRequiresAction,
}: LawmindAppRootDialogsProps) {
  return (
    <>
      {apiBase ? (
        <LawmindDelegateAssistDialog
          open={delegateAssistOpen}
          apiBase={apiBase}
          fromAssistantId={selectedAssistantId}
          parentSessionId={activeChatSessionId ?? undefined}
          matterId={contextMatterId}
          taskDefault={delegateTaskDefault}
          assistants={assistants}
          delegations={delegations}
          modelCatalog={modelCatalog}
          selectedModelId={selectedModelId}
          onClose={onCloseDelegateAssist}
          onDelegated={onDelegated}
        />
      ) : null}
      {apiBase ? (
        <>
          <LawmindCreateMatterDialog
            open={createMatterOpen}
            apiBase={apiBase}
            onClose={onCloseCreateMatter}
            onSuccess={onCreateMatterSuccess}
          />
          <LawmindMatterRenameDialog
            open={matterRenameOpen}
            apiBase={apiBase}
            onClose={onCloseMatterRename}
            onSuccess={onMatterRenameSuccess}
          />
          <LawmindMatterDeleteDialog
            open={matterDeleteOpen}
            apiBase={apiBase}
            onClose={onCloseMatterDelete}
            onSuccess={onMatterDeleteSuccess}
            onListChanged={onMatterListChanged}
          />
        </>
      ) : null}
      {apiBase ? (
        <LawmindActionHub
          apiBase={apiBase}
          matterId={contextMatterId}
          open={showActionHub}
          onClose={onCloseActionHub}
          onRefreshSummary={() => void onRefreshActionSummary()}
          sessionRequiresActions={sessionRequiresActions}
          sessionId={sessionId ?? undefined}
          onChatResumeComplete={() => void onChatResumeComplete()}
        />
      ) : null}
      {apiBase ? (
        <LawmindTaskDrawer
          open={taskDrawerOpen}
          onClose={onCloseTaskDrawer}
          apiBase={apiBase}
          matterId={contextMatterId}
        />
      ) : null}
      <LawmindToolApprovalDialog
        open={toolApprovalDialogAction !== null}
        action={toolApprovalDialogAction}
        busy={loading}
        onClose={onCloseToolApproval}
        onReject={() => {
          const action = toolApprovalDialogAction;
          onCloseToolApproval();
          if (action) {
            void onResumeRequiresAction(action, "reject", undefined, undefined, {
              skipApprovalDialog: true,
            });
          }
        }}
        onApprove={() => {
          const action = toolApprovalDialogAction;
          onCloseToolApproval();
          if (action) {
            void onResumeRequiresAction(action, "approve", undefined, undefined, {
              skipApprovalDialog: true,
            });
          }
        }}
      />
    </>
  );
}

export const LawmindAppRootDialogs = React.memo(LawmindAppRootDialogsImpl);
