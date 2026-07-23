import { useMemo } from "react";
import type { AgentsDeskTab } from "../lawmind-agents-desk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type { ModelCatalogEntry, ProviderKeyStatus } from "../lawmind-models-api";
import type { LawmindMainView } from "../lawmind-main-view";
import type {
  LawmindSettingsScrollAnchorId,
  LawmindSettingsSectionId,
} from "../lawmind-settings-shell";
import type { LawmindAppSettingsPanelProps } from "./LawmindAppSettingsPanel";

export type UseLawmindAppSettingsPanelPropsInput = {
  showSettings: boolean;
  setShowSettings: (open: boolean) => void;
  settingsSectionId: LawmindSettingsSectionId;
  settingsScrollAnchor?: LawmindSettingsScrollAnchorId;
  config: AppConfig | null;
  projectDir: string | null;
  workspaceLabel: string;
  health: LawmindHealthState;
  collabSummarySettings: CollabSummaryState;
  selectedAssistantId: string;
  setSelectedAssistantId: (assistantId: string) => void;
  selectedAssistant: AssistantRow | undefined;
  selectedAssistantStats: AssistantRow["stats"] | undefined;
  retrievalLabel: string;
  retrievalSaving: boolean;
  draftWithModelSaving: boolean;
  openNewAssistant: (presetKey?: string) => void;
  openEditAssistant: () => void;
  removeAssistant: () => void | Promise<void>;
  applyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  applyDraftWithModelEnabled: (enabled: boolean) => void | Promise<void>;
  reconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
  openApiWizard: () => void;
  modelProviders: ProviderKeyStatus[];
  platformProviders: import("../lawmind-models-api").PlatformProviderKeyStatus[];
  platformMode: "proxy" | "platform_key" | "none";
  selectedModelId: string;
  modelCatalog: ModelCatalogEntry[];
  refreshModelsCatalog: (apiBase: string) => void | Promise<void>;
  pickProject: () => void | Promise<void>;
  clearProject: () => void | Promise<void>;
  setAgentsDeskTab: (tab: AgentsDeskTab) => void;
  setAgentsNeedsDecisionFocus?: (focus: boolean) => void;
  setMainView: (view: LawmindMainView) => void;
  assistants: AssistantRow[];
  onPrefsChange: () => void;
  matterSidebarRows?: Array<{ matterId?: string | null; title: string }>;
  contextMatterId?: string | null;
  onOpenReviewFromAutomation?: (taskId: string, matterId?: string) => void;
};

export function useLawmindAppSettingsPanelProps(
  input: UseLawmindAppSettingsPanelPropsInput,
): LawmindAppSettingsPanelProps {
  const {
    showSettings,
    setShowSettings,
    settingsSectionId,
    settingsScrollAnchor,
    config,
    projectDir,
    workspaceLabel,
    health,
    collabSummarySettings,
    selectedAssistantId,
    setSelectedAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    openNewAssistant,
    openEditAssistant,
    removeAssistant,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    reconnectLocalService,
    localServiceReconnecting,
    openApiWizard,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    modelCatalog,
    refreshModelsCatalog,
    pickProject,
    clearProject,
    setAgentsDeskTab,
    setAgentsNeedsDecisionFocus,
    setMainView,
    assistants,
    onPrefsChange,
    matterSidebarRows = [],
    contextMatterId = null,
    onOpenReviewFromAutomation,
  } = input;

  const automationMatterOptions = useMemo(() => {
    const out: Array<{ id: string; title: string }> = [];
    const seen = new Set<string>();
    for (const row of matterSidebarRows) {
      const id = row.matterId?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push({ id, title: row.title?.trim() || id });
    }
    return out;
  }, [matterSidebarRows]);

  const automationMatterId =
    contextMatterId?.trim() ||
    automationMatterOptions[0]?.id ||
    null;

  return useMemo(
    (): LawmindAppSettingsPanelProps => ({
      open: showSettings,
      initialSectionId: settingsSectionId,
      scrollAnchorId: settingsScrollAnchor,
      config,
      projectDir,
      workspaceLabel,
      health,
      collabSummarySettings,
      assistants,
      selectedAssistantId,
      onSelectAssistantId: setSelectedAssistantId,
      selectedAssistant,
      selectedAssistantStats,
      retrievalLabel,
      retrievalSaving,
      draftWithModelSaving,
      onClose: () => setShowSettings(false),
      onOpenNewAssistant: openNewAssistant,
      onOpenEditAssistant: openEditAssistant,
      onRemoveAssistant: () => void removeAssistant(),
      onApplyRetrievalMode: applyRetrievalMode,
      onApplyDraftWithModelEnabled: applyDraftWithModelEnabled,
      onReconnectLocalService: reconnectLocalService,
      localServiceReconnecting,
      onOpenApiWizard: openApiWizard,
      modelProviders,
      platformProviders,
      platformMode,
      selectedModelId,
      customModels: modelCatalog.filter((m) => m.kind === "custom"),
      modelCatalog,
      onModelsChanged: async () => {
        if (config?.apiBase) {
          await refreshModelsCatalog(config.apiBase);
        }
      },
      onPickProject: () => void pickProject(),
      onClearProject: () => void clearProject(),
      onOpenCollaborationPage: () => {
        // 「去在办处理」→ 待拍板（领导主入口）；按流程仍可从在办分区进入。
        setAgentsDeskTab("active");
        setMainView("agents");
        setShowSettings(false);
      },
      onPrefsChange,
      automationMatterId,
      automationMatterOptions,
      onOpenAutomationsNeedsDecision: () => {
        setAgentsNeedsDecisionFocus?.(true);
        setAgentsDeskTab("active");
        setMainView("agents");
        setShowSettings(false);
      },
      onOpenAutomationsReview: (taskId, matterId) => {
        setShowSettings(false);
        onOpenReviewFromAutomation?.(taskId, matterId);
      },
      onOpenAutomationsCollaboration: () => {
        setAgentsDeskTab("workflows");
        setMainView("agents");
        setShowSettings(false);
      },
    }),
    [
      showSettings,
      settingsSectionId,
      settingsScrollAnchor,
      config,
      projectDir,
      workspaceLabel,
      health,
      collabSummarySettings,
      assistants,
      selectedAssistantId,
      setSelectedAssistantId,
      selectedAssistant,
      selectedAssistantStats,
      retrievalLabel,
      retrievalSaving,
      draftWithModelSaving,
      setShowSettings,
      openNewAssistant,
      openEditAssistant,
      removeAssistant,
      applyRetrievalMode,
      applyDraftWithModelEnabled,
      reconnectLocalService,
      localServiceReconnecting,
      openApiWizard,
      modelProviders,
      platformProviders,
      platformMode,
      selectedModelId,
      modelCatalog,
      refreshModelsCatalog,
      pickProject,
      clearProject,
      setAgentsDeskTab,
      setAgentsNeedsDecisionFocus,
      setMainView,
      onPrefsChange,
      automationMatterId,
      automationMatterOptions,
      onOpenReviewFromAutomation,
    ],
  );
}
