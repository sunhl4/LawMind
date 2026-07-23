import { useMemo } from "react";
import type { HealthPayload } from "../lawmind-app-data";
import type { LawmindMainView } from "../lawmind-main-view";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type { SetShowSettings } from "../lawmind-settings-shell";
import type { LawmindAppHeaderProps } from "./LawmindAppHeader";

export type UseLawmindAppHeaderPropsInput = {
  mainView: LawmindMainView;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  setSelectedAssistantId: (id: string) => void;
  matterCockpitOpen: boolean;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMainView: (view: LawmindMainView) => void;
  apiBase: string | undefined;
  setAgentsNeedsDecisionFocus?: (focus: boolean) => void;
  projectDir: string | null;
  currentMatterLabel: string | null;
  contextMatterId?: string | null;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  wsShowEditor: boolean;
  setWsShowEditor: React.Dispatch<React.SetStateAction<boolean>>;
  wsShowChat: boolean;
  setWsShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  canUseFilesystemBridge: boolean;
  reviewPaneVisibility: ReviewPaneVisibility;
  toggleReviewPane: (id: ReviewPaneId) => void;
  setShowSettings: SetShowSettings;
  showSettings: boolean;
  health: HealthPayload | null | undefined;
  workspaceDir: string | undefined;
  localServiceReconnecting: boolean;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  openApiWizard: () => void;
  composeModelQuickTest: () => void | Promise<void>;
  composeModelQuickTestBusy: boolean;
};

export function useLawmindAppHeaderProps(input: UseLawmindAppHeaderPropsInput): LawmindAppHeaderProps {
  const {
    mainView,
    assistants,
    selectedAssistantId,
    setSelectedAssistantId,
    matterCockpitOpen,
    setMatterCockpitOpen,
    setMainView,
    apiBase,
    setAgentsNeedsDecisionFocus,
    projectDir,
    currentMatterLabel,
    contextMatterId,
    sidebarCollapsed,
    setSidebarCollapsed,
    wsShowEditor,
    setWsShowEditor,
    wsShowChat,
    setWsShowChat,
    canUseFilesystemBridge,
    reviewPaneVisibility,
    toggleReviewPane,
    setShowSettings,
    showSettings,
    health,
    workspaceDir,
    localServiceReconnecting,
    modelCatalog,
    selectedModelId,
    openApiWizard,
    composeModelQuickTest,
    composeModelQuickTestBusy,
  } = input;

  return useMemo(
    (): LawmindAppHeaderProps => ({
      mainView,
      assistants,
      selectedAssistantId,
      onSelectAssistantId: setSelectedAssistantId,
      matterCockpitOpen,
      onExitMatterCockpit: () => setMatterCockpitOpen(false),
      onSetMainView: setMainView,
      onOpenMatterCockpit: contextMatterId?.trim()
        ? () => {
            setMatterCockpitOpen(true);
            setMainView("workspace");
          }
        : undefined,
      apiBase,
      onClearNeedsDecisionFocus: () => setAgentsNeedsDecisionFocus?.(false),
      projectDir,
      currentMatterLabel,
      sidebarCollapsed,
      wsShowEditor,
      wsShowChat,
      canUseFilesystemBridge,
      onToggleSidebar: () => setSidebarCollapsed((v) => !v),
      onToggleEditor: () => {
        if (canUseFilesystemBridge && !matterCockpitOpen) {
          setWsShowEditor((v) => !v);
        }
      },
      onToggleChat: () => {
        if (!matterCockpitOpen) {
          setWsShowChat((v) => !v);
        }
      },
      reviewPaneVisibility,
      onToggleReviewPane: toggleReviewPane,
      onOpenSettings: () => setShowSettings(true),
      onCloseSettings: () => setShowSettings(false),
      settingsOpen: showSettings,
      // Only nag until the model is ready — configured Solo lawyers stay in chat chrome.
      showReadinessStrip: Boolean(
        apiBase && mainView !== "review" && health && health.modelConfigured !== true,
      ),
      health,
      workspaceDir,
      localServiceReconnecting,
      modelCatalog,
      selectedModelId,
      onOpenApiWizard: openApiWizard,
      onOpenDoctor: () => {
        setShowSettings(true, "doctor");
      },
      onVerifyModel: composeModelQuickTest,
      composeModelQuickTestBusy,
    }),
    [
      mainView,
      assistants,
      selectedAssistantId,
      setSelectedAssistantId,
      matterCockpitOpen,
      setMatterCockpitOpen,
      setMainView,
      apiBase,
      setAgentsNeedsDecisionFocus,
      projectDir,
      currentMatterLabel,
      contextMatterId,
      sidebarCollapsed,
      setSidebarCollapsed,
      wsShowEditor,
      setWsShowEditor,
      wsShowChat,
      setWsShowChat,
      canUseFilesystemBridge,
      reviewPaneVisibility,
      toggleReviewPane,
      setShowSettings,
      showSettings,
      health,
      workspaceDir,
      localServiceReconnecting,
      modelCatalog,
      selectedModelId,
      openApiWizard,
      composeModelQuickTest,
      composeModelQuickTestBusy,
    ],
  );
}
