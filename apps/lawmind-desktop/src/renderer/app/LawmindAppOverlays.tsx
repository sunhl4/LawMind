import type { RefObject } from "react";
import { HelpPanel } from "../HelpPanel";
import { LawmindApiSetupWizard } from "../LawmindApiSetupWizard";
import { LawmindAssistantEditorDialog, type AssistantEditorDraft } from "../lawmind-assistant-editor";
import { LawmindDetailDialog, type DetailKind } from "../lawmind-app-detail";
import type { AppConfig } from "../lawmind-app-bootstrap";
import { artifactApiRelFromOutput, formatLocaleDateTime } from "../lawmind-app-utils";
import type {
  ArtifactDraft,
  TaskExecutionPlanStep,
  TaskRecord,
} from "../../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../../src/lawmind/tasks/checkpoints.ts";
import { LawmindFirstRunDialog } from "../LawmindFirstRunDialog";
import type { PresetRow } from "../lawmind-app-data";
import type { AssistantRow } from "../lawmind-settings-models.ts";

export type LawmindAppOverlaysProps = {
  showWizard: boolean;
  wizApiKey: string;
  setWizApiKey: (value: string) => void;
  wizHasExistingKey: boolean;
  wizBaseUrl: string;
  setWizBaseUrl: (value: string) => void;
  wizModel: string;
  setWizModel: (value: string) => void;
  wizWorkspace: string;
  wizRetrievalMode: "single" | "dual";
  setWizRetrievalMode: (mode: "single" | "dual") => void;
  wizError: string | null;
  wizBusy: boolean;
  onPickWorkspace: () => void;
  onWizardCancel: () => void;
  onWizardSave: () => void;
  detailOpen: boolean;
  detailKind: DetailKind;
  detailId: string | null;
  detailLoading: boolean;
  detailError: string | null;
  detailTask: TaskRecord | null;
  detailDraft: ArtifactDraft | null;
  detailCitationIntegrity: DraftCitationIntegrityView | null;
  detailCheckpoints: TaskCheckpoint[] | null;
  detailExecutionPlan: TaskExecutionPlanStep[] | null;
  canUseFilesystemBridge: boolean;
  apiBase: string | undefined;
  onCloseDetail: () => void;
  onPreviewArtifact: (outputPath?: string) => void;
  onOpenOutputInFolder: (outputPath?: string) => void;
  onUseTaskContext: (taskId: string, matterId: string | null) => void;
  showAssistantEditor: boolean;
  editingAssistantId: string | null;
  assistantDraft: AssistantEditorDraft;
  presets: PresetRow[];
  assistants: AssistantRow[];
  asstBusy: boolean;
  asstError: string | null;
  onAssistantDraftChange: (draft: AssistantEditorDraft) => void;
  onCloseAssistantEditor: () => void;
  onSaveAssistant: (draftOverride?: import("../lawmind-assistant-editor").AssistantEditorDraft) => void;
  showHelp: boolean;
  onCloseHelp: () => void;
  onOpenWorkflowLibrary: (() => void) | undefined;
  onOpenAdvancedSettings: () => void;
  onFirstRunSeedReady: (opts: { matterId: string; seedPrompt: string }) => void;
  /** When true, FirstRun waits until API wizard finishes / model is configured. */
  suppressFirstRunAutoOpen?: boolean;
  composeTextareaRef: RefObject<HTMLTextAreaElement | null>;
  config: AppConfig | null;
};

export function LawmindAppOverlays(props: LawmindAppOverlaysProps) {
  const {
    showWizard,
    wizApiKey,
    setWizApiKey,
    wizHasExistingKey,
    wizBaseUrl,
    setWizBaseUrl,
    wizModel,
    setWizModel,
    wizWorkspace,
    wizRetrievalMode,
    setWizRetrievalMode,
    wizError,
    wizBusy,
    onPickWorkspace,
    onWizardCancel,
    onWizardSave,
    detailOpen,
    detailKind,
    detailId,
    detailLoading,
    detailError,
    detailTask,
    detailDraft,
    detailCitationIntegrity,
    detailCheckpoints,
    detailExecutionPlan,
    canUseFilesystemBridge,
    apiBase,
    onCloseDetail,
    onPreviewArtifact,
    onOpenOutputInFolder,
    onUseTaskContext,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    presets,
    assistants,
    asstBusy,
    asstError,
    onAssistantDraftChange,
    onCloseAssistantEditor,
    onSaveAssistant,
    showHelp,
    onCloseHelp,
    onOpenWorkflowLibrary,
    onOpenAdvancedSettings,
    onFirstRunSeedReady,
    suppressFirstRunAutoOpen = false,
    composeTextareaRef,
    config,
  } = props;

  return (
    <>
      {showWizard && (
        <LawmindApiSetupWizard
          wizApiKey={wizApiKey}
          setWizApiKey={setWizApiKey}
          wizHasExistingKey={wizHasExistingKey}
          wizBaseUrl={wizBaseUrl}
          setWizBaseUrl={setWizBaseUrl}
          wizModel={wizModel}
          setWizModel={setWizModel}
          wizWorkspace={wizWorkspace}
          wizRetrievalMode={wizRetrievalMode}
          setWizRetrievalMode={setWizRetrievalMode}
          wizError={wizError}
          wizBusy={wizBusy}
          onPickWorkspace={() =>  onPickWorkspace()}
          onCancel={onWizardCancel}
          onSave={() =>  onWizardSave()}
        />
      )}
      <LawmindDetailDialog
        open={detailOpen}
        detailKind={detailKind}
        detailId={detailId}
        detailLoading={detailLoading}
        detailError={detailError}
        detailTask={detailTask}
        detailDraft={detailDraft}
        detailCitationIntegrity={detailCitationIntegrity}
        detailCheckpoints={detailCheckpoints}
        detailExecutionPlan={detailExecutionPlan}
        canUseFilesystemBridge={canUseFilesystemBridge}
        apiBase={apiBase}
        onClose={onCloseDetail}
        onPreviewArtifact={onPreviewArtifact}
        onOpenOutputInFolder={onOpenOutputInFolder}
        onUseTaskContext={onUseTaskContext}
        formatLocaleDateTime={formatLocaleDateTime}
        artifactApiRelFromOutput={artifactApiRelFromOutput}
      />
      <LawmindAssistantEditorDialog
        open={showAssistantEditor}
        editingAssistantId={editingAssistantId}
        draft={assistantDraft}
        presets={presets}
        assistantLinkOptions={assistants
          .filter((a) => a.assistantId !== editingAssistantId)
          .map((a) => ({ assistantId: a.assistantId, displayName: a.displayName }))}
        busy={asstBusy}
        error={asstError}
        onChange={onAssistantDraftChange}
        onClose={onCloseAssistantEditor}
        onSave={(draftOverride) => onSaveAssistant(draftOverride)}
      />
      {showHelp && <HelpPanel onClose={onCloseHelp} />}
      <LawmindFirstRunDialog
        apiBase={config?.apiBase ?? ""}
        suppressAutoOpen={suppressFirstRunAutoOpen}
        onOpenWorkflowLibrary={onOpenWorkflowLibrary}
        onOpenAdvancedSettings={onOpenAdvancedSettings}
        onClose={() => {
          /* dismiss handled inside the dialog */
        }}
        onSeedReady={({ matterId, seedPrompt }) => {
          onFirstRunSeedReady({ matterId, seedPrompt });
          composeTextareaRef.current?.focus();
        }}
      />
    </>
  );
}
