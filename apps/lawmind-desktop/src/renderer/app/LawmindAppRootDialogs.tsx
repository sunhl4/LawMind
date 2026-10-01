import React from "react";
import { LawmindCreateMatterDialog } from "../LawmindCreateMatterDialog";
import { LawmindMatterDeleteDialog } from "../LawmindMatterRenameDeleteDialogs";
import { LawmindDelegateAssistDialog } from "../LawmindDelegateAssistDialog";
import { LawmindTaskDrawer } from "../LawmindTaskDrawer";
import { LawmindGlobalSearch } from "../LawmindGlobalSearch";
import type { CommandPaletteAction } from "../LawmindCommandPalette";
import type { DeskMatterFocusPane } from "./desk-matter-focus";
import type { DelegationRow } from "../lawmind-app-data";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { AssistantRow } from "../lawmind-settings-models.ts";

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
  onCreateAssistant?: () => void;
  createMatterOpen: boolean;
  onCloseCreateMatter: () => void;
  onCreateMatterSuccess: (matterId: string) => void;
  matterDeleteOpen: { matterId: string; label: string } | null;
  onCloseMatterDelete: () => void;
  onMatterDeleteSuccess: (matterId: string) => void;
  onMatterListChanged: () => void;
  taskDrawerOpen: boolean;
  onCloseTaskDrawer: () => void;
  globalSearchOpen: boolean;
  setGlobalSearchOpen: (open: boolean) => void;
  globalSearchCommands: CommandPaletteAction[];
  openMatterDossierFromSearch: (matterId: string, pane?: DeskMatterFocusPane) => void;
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
  onCreateAssistant,
  createMatterOpen,
  onCloseCreateMatter,
  onCreateMatterSuccess,
  matterDeleteOpen,
  onCloseMatterDelete,
  onMatterDeleteSuccess,
  onMatterListChanged,
  taskDrawerOpen,
  onCloseTaskDrawer,
  globalSearchOpen,
  setGlobalSearchOpen,
  globalSearchCommands,
  openMatterDossierFromSearch,
}: LawmindAppRootDialogsProps) {
  return (
    <>
      {apiBase ? (
        <LawmindGlobalSearch
          open={globalSearchOpen}
          onClose={() => setGlobalSearchOpen(false)}
          apiBase={apiBase}
          actions={globalSearchCommands}
          onOpenMatterDossier={openMatterDossierFromSearch}
        />
      ) : null}
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
          onCreateAssistant={onCreateAssistant}
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
        <LawmindTaskDrawer
          open={taskDrawerOpen}
          onClose={onCloseTaskDrawer}
          apiBase={apiBase}
          matterId={contextMatterId}
        />
      ) : null}
    </>
  );
}

export const LawmindAppRootDialogs = React.memo(LawmindAppRootDialogsImpl);
