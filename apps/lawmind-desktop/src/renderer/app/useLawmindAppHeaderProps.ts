import { useMemo } from "react";
import { buildReadinessSnapshot } from "../lawmind-readiness";
import type { HealthPayload } from "../lawmind-app-data";
import type { LawmindMainView } from "../lawmind-main-view";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type { LawmindAppHeaderProps } from "./LawmindAppHeader";
import { useReviewPaneVisibilityStore } from "../stores/review-pane-visibility-store";
import { useSettingsPanelStore } from "../stores/settings-panel-store";

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
  const reviewPaneVisibility = useReviewPaneVisibilityStore((s) => s.visibility);
  const toggleReviewPane = useReviewPaneVisibilityStore((s) => s.togglePane);
  const showSettings = useSettingsPanelStore((s) => s.open);
  const setShowSettings = useSettingsPanelStore((s) => s.setSettingsPanel);

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
      // 未全部就绪即提示（模型未配置/未验证、本地服务断连、工作区异常），
      // 与 LawmindReadinessStrip 的 allReady 口径一致，不再仅「模型未配置」才提示。
      showReadinessStrip: Boolean(
        apiBase &&
          mainView !== "review" &&
          !buildReadinessSnapshot({
            health: health ?? null,
            workspaceDir,
            apiReachable: Boolean(health) && !localServiceReconnecting,
            modelCatalog,
            selectedModelId,
          }).allReady,
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
      health,
      workspaceDir,
      localServiceReconnecting,
      modelCatalog,
      selectedModelId,
      openApiWizard,
      composeModelQuickTest,
      composeModelQuickTestBusy,
      reviewPaneVisibility,
      toggleReviewPane,
      setShowSettings,
      showSettings,
    ],
  );
}
