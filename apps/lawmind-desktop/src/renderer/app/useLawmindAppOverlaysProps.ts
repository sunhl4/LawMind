import { useMemo, type RefObject } from "react";
import type { CollaborationDeskTab } from "../LawmindCollaborationDesk";
import type { AssistantEditorDraft } from "../lawmind-assistant-editor";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { PresetRow } from "../lawmind-app-data";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type { DetailKind } from "../lawmind-app-detail";
import type {
  ArtifactDraft,
  TaskExecutionPlanStep,
  TaskRecord,
} from "../../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../../src/lawmind/tasks/checkpoints.ts";
import type { LawmindAppOverlaysProps } from "./LawmindAppOverlays";
import type { SetShowSettings } from "../lawmind-settings-shell";

export type UseLawmindAppOverlaysPropsInput = {
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
  pickWs: () => void | Promise<void>;
  setShowWizard: (open: boolean) => void;
  runWizardSave: () => void | Promise<void>;
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
  closeDetail: () => void;
  previewArtifact: (outputPath?: string) => void;
  openOutputInFolder: (outputPath?: string) => void;
  setContextTaskId: (id: string | null) => void;
  setContextMatterId: (id: string | null) => void;
  showAssistantEditor: boolean;
  editingAssistantId: string | null;
  assistantDraft: AssistantEditorDraft;
  presets: PresetRow[];
  assistants: AssistantRow[];
  asstBusy: boolean;
  asstError: string | null;
  setAssistantDraft: (draft: AssistantEditorDraft) => void;
  setShowAssistantEditor: (open: boolean) => void;
  saveAssistant: () => void | Promise<void>;
  showHelp: boolean;
  setShowHelp: (open: boolean) => void;
  config: AppConfig | null;
  setCollaborationDeskTab: (tab: CollaborationDeskTab) => void;
  setMainView: (view: "workspace" | "collaboration" | "review") => void;
  setShowSettings: SetShowSettings;
  setInput: (value: string) => void;
  composeTextareaRef: RefObject<HTMLTextAreaElement | null>;
};

export function useLawmindAppOverlaysProps(input: UseLawmindAppOverlaysPropsInput): LawmindAppOverlaysProps {
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
    pickWs,
    setShowWizard,
    runWizardSave,
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
    closeDetail,
    previewArtifact,
    openOutputInFolder,
    setContextTaskId,
    setContextMatterId,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    presets,
    assistants,
    asstBusy,
    asstError,
    setAssistantDraft,
    setShowAssistantEditor,
    saveAssistant,
    showHelp,
    setShowHelp,
    config,
    setCollaborationDeskTab,
    setMainView,
    setShowSettings,
    setInput,
    composeTextareaRef,
  } = input;

  return useMemo(
    (): LawmindAppOverlaysProps => ({
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
      onPickWorkspace: () => void pickWs(),
      onWizardCancel: () => setShowWizard(false),
      onWizardSave: () => void runWizardSave(),
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
      onCloseDetail: closeDetail,
      onPreviewArtifact: previewArtifact,
      onOpenOutputInFolder: openOutputInFolder,
      onUseTaskContext: (taskId, matterId) => {
        setContextTaskId(taskId);
        setContextMatterId(matterId ?? null);
        closeDetail();
      },
      showAssistantEditor,
      editingAssistantId,
      assistantDraft,
      presets,
      assistants,
      asstBusy,
      asstError,
      onAssistantDraftChange: setAssistantDraft,
      onCloseAssistantEditor: () => setShowAssistantEditor(false),
      onSaveAssistant: () => void saveAssistant(),
      showHelp,
      onCloseHelp: () => setShowHelp(false),
      onOpenWorkflowLibrary: config
        ? () => {
            setCollaborationDeskTab("workflows");
            setMainView("collaboration");
          }
        : undefined,
      onOpenAdvancedSettings: () => {
        setShowSettings(true, "doctor");
      },
      onFirstRunSeedReady: ({ matterId, seedPrompt }) => {
        setContextMatterId(matterId);
        setInput(seedPrompt);
      },
      composeTextareaRef,
      config,
    }),
    [
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
      pickWs,
      setShowWizard,
      runWizardSave,
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
      closeDetail,
      previewArtifact,
      openOutputInFolder,
      setContextTaskId,
      setContextMatterId,
      showAssistantEditor,
      editingAssistantId,
      assistantDraft,
      presets,
      assistants,
      asstBusy,
      asstError,
      setAssistantDraft,
      setShowAssistantEditor,
      saveAssistant,
      showHelp,
      setShowHelp,
      config,
      setCollaborationDeskTab,
      setMainView,
      setShowSettings,
      setInput,
      composeTextareaRef,
    ],
  );
}
