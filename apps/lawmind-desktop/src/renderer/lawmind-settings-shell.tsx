import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LawmindSettingsAppUpdate } from "./LawmindSettingsAppUpdate";
import { LawmindSettingsAssistants } from "./LawmindSettingsAssistants";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsCollaborationBrief } from "./LawmindSettingsCollaboration";
import { LawmindSettingsDisclaimer } from "./LawmindSettingsDisclaimer";
import { LawmindSettingsEdition } from "./LawmindSettingsEdition";
import { LawmindSettingsModelRetrieval } from "./LawmindSettingsModelRetrieval";
import { LawmindSettingsOnboarding } from "./LawmindSettingsOnboarding";
import { LawmindSettingsRoles } from "./LawmindSettingsRoles";
import { LawmindSettingsTemplates } from "./LawmindSettingsTemplates";
import { LawmindSettingsAppearance } from "./LawmindSettingsAppearance";
import { LawmindSettingsReviewPrefs } from "./LawmindSettingsReviewPrefs";
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";
import { LawmindSettingsDoctor } from "./LawmindSettingsDoctor";
import { LawmindSettingsMemory } from "./LawmindSettingsMemory";
import { LawmindSettingsTools } from "./LawmindSettingsTools";
import { LawmindSettingsUsageStats } from "./LawmindSettingsUsageStats";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { HealthPayload } from "./lawmind-app-data";
import type { ModelCatalogEntry, ProviderKeyStatus } from "./lawmind-models-api";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import {
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  type LawmindSettingsScrollAnchorId,
  type LawmindSettingsSectionId,
  filterSettingsNavGroups,
  firstSettingsNavMatch,
  readStoredSettingsSection,
  settingsNavItem,
  writeStoredSettingsSection,
} from "./lawmind-settings-nav";

export type {
  LawmindSettingsScrollAnchorId,
  LawmindSettingsSectionId,
} from "./lawmind-settings-nav";
export {
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  LAWMIND_SETTINGS_SCROLL_ANCHORS,
  lawmindSettingsSectionFromDomId,
  readStoredSettingsSection,
} from "./lawmind-settings-nav";

type SetProjectDirBridge = NonNullable<Window["lawmindDesktop"]>["setProjectDir"];

export type SetShowSettings = (
  open: boolean | ((prev: boolean) => boolean),
  sectionId?: LawmindSettingsSectionId,
  scrollAnchorId?: LawmindSettingsScrollAnchorId,
) => void;

export async function clearProjectDirectory(args: {
  config: AppConfig | null;
  setProjectDir?: SetProjectDirBridge;
}): Promise<{ projectDir?: string | null; apiBase?: string; error?: string }> {
  const { config, setProjectDir } = args;
  if (!config || !setProjectDir) {
    return {};
  }
  const response = await setProjectDir(null);
  if (!response.ok) {
    return { error: response.error || "关闭项目失败" };
  }
  return {
    projectDir: response.projectDir ?? null,
    apiBase: typeof response.apiBase === "string" ? response.apiBase : undefined,
  };
}

type Props = {
  open: boolean;
  initialSectionId?: LawmindSettingsSectionId;
  scrollAnchorId?: LawmindSettingsScrollAnchorId;
  config: AppConfig | null;
  projectDir: string | null;
  workspaceLabel: string;
  health: {
    modelConfigured: boolean;
    retrievalMode?: string;
    dualLegalConfigured?: boolean;
    webSearchApiKeyConfigured?: boolean;
    modelName?: string | null;
    modelEnvFileExists?: boolean;
    draftWithModelEnabled?: boolean;
    draftWithModelActive?: boolean;
  } | null;
  /** Full GET /api/health payload (doctor section); avoids redundant refetch when bootstrap already loaded it. */
  healthPayload?: HealthPayload | null;
  collabSummarySettings: CollabSummaryState;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (assistantId: string) => void;
  selectedAssistant?: AssistantRow;
  selectedAssistantStats?: AssistantRow["stats"];
  retrievalLabel: string;
  retrievalSaving: boolean;
  draftWithModelSaving?: boolean;
  onClose: () => void;
  onOpenNewAssistant: () => void;
  onOpenEditAssistant: () => void;
  onRemoveAssistant: () => void | Promise<void>;
  onApplyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  onApplyDraftWithModelEnabled?: (enabled: boolean) => void | Promise<void>;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
  onOpenApiWizard: () => void;
  modelProviders?: ProviderKeyStatus[];
  platformProviders?: import("./lawmind-models-api").PlatformProviderKeyStatus[];
  platformMode?: "proxy" | "platform_key" | "none";
  selectedModelId?: string;
  customModels?: ModelCatalogEntry[];
  modelCatalog?: ModelCatalogEntry[];
  onModelsChanged?: () => void | Promise<void>;
  onPickProject: () => void | Promise<void>;
  onClearProject: () => void | Promise<void>;
  onOpenCollaborationPage: () => void;
  onPrefsChange?: () => void;
};

function LawmindSettingsContentHeader(props: { title: string; description: string }): ReactNode {
  const { title, description } = props;
  return (
    <header className="lm-settings-content-header">
      <h2 className="lm-settings-content-title">{title}</h2>
      <p className="lm-settings-content-desc">{description}</p>
    </header>
  );
}

/** Full-page settings (main column), not a modal overlay. */
export function LawmindSettingsPage({
  open,
  initialSectionId = LAWMIND_SETTINGS_DEFAULT_SECTION,
  scrollAnchorId,
  config,
  projectDir,
  workspaceLabel,
  health,
  healthPayload = null,
  collabSummarySettings,
  assistants,
  selectedAssistantId,
  onSelectAssistantId,
  selectedAssistant,
  selectedAssistantStats,
  retrievalLabel,
  retrievalSaving,
  draftWithModelSaving = false,
  onClose,
  onOpenNewAssistant,
  onOpenEditAssistant,
  onRemoveAssistant,
  onApplyRetrievalMode,
  onApplyDraftWithModelEnabled,
  onReconnectLocalService,
  localServiceReconnecting = false,
  onOpenApiWizard,
  modelProviders,
  platformProviders,
  platformMode,
  selectedModelId,
  customModels,
  modelCatalog = customModels,
  onModelsChanged,
  onPickProject,
  onClearProject,
  onOpenCollaborationPage,
  onPrefsChange,
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState<LawmindSettingsSectionId>(initialSectionId);
  const [navQuery, setNavQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setActiveSectionId(initialSectionId);
      setNavQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, initialSectionId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !scrollAnchorId) {
      return;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(scrollAnchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, scrollAnchorId, activeSectionId]);

  const filteredGroups = useMemo(() => filterSettingsNavGroups(navQuery), [navQuery]);
  const activeMeta = settingsNavItem(activeSectionId);
  const navSearching = navQuery.trim().length > 0;

  if (!open) {
    return null;
  }

  const navigateToSection = (sectionId: LawmindSettingsSectionId) => {
    setActiveSectionId(sectionId);
    writeStoredSettingsSection(sectionId);
  };

  const sectionBody = renderSettingsSection({
    activeSectionId,
    config,
    projectDir,
    workspaceLabel,
    health,
    healthPayload,
    collabSummarySettings,
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    onClose,
    onOpenNewAssistant,
    onOpenEditAssistant,
    onRemoveAssistant,
    onApplyRetrievalMode,
    onApplyDraftWithModelEnabled,
    onReconnectLocalService,
    localServiceReconnecting,
    onOpenApiWizard,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    customModels,
    modelCatalog,
    onModelsChanged,
    onPickProject,
    onClearProject,
    onOpenCollaborationPage,
    onPrefsChange,
    navigateToSection,
  });

  return (
    <div className="lm-settings-page" role="region" aria-label="设置">
      <div className="lm-settings-layout">
        <aside className="lm-settings-sidebar" aria-label="设置分类">
          <div className="lm-settings-nav-search">
            <input
              ref={searchRef}
              type="search"
              className="lm-settings-nav-search-input"
              placeholder="搜索设置…（Enter 跳转）"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              aria-label="搜索设置项"
              onKeyDown={(e) => {
                if (e.key !== "Enter") {
                  return;
                }
                e.preventDefault();
                const match = firstSettingsNavMatch(navQuery);
                if (match) {
                  navigateToSection(match);
                  setNavQuery("");
                }
              }}
            />
          </div>
          <nav className="lm-settings-nav" aria-label="设置分类列表">
            {filteredGroups.length === 0 ? (
              <p className="lm-meta lm-settings-nav-empty">无匹配项</p>
            ) : (
              filteredGroups.map((group) => (
                <div key={group.id} className="lm-settings-nav-group">
                  <div className="lm-settings-nav-group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`lm-settings-nav-item${activeSectionId === item.id ? " is-active" : ""}`}
                      aria-current={activeSectionId === item.id ? "page" : undefined}
                      onClick={() => navigateToSection(item.id)}
                    >
                      <span className="lm-settings-nav-item-label">{item.label}</span>
                      {navSearching ? (
                        <span className="lm-settings-nav-item-hint">{item.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </nav>
          <footer className="lm-settings-sidebar-footer">
            <span className="lm-settings-sidebar-version" title="LawMind 桌面版">
              v{config?.appVersion?.trim() || "dev"}
            </span>
            <button
              type="button"
              className="lm-link-btn lm-settings-sidebar-about-link"
              onClick={() => navigateToSection("app-update")}
            >
              更新
            </button>
          </footer>
        </aside>
        <div className="lm-settings-content">
          <div className="lm-settings-content-inner">
            {activeMeta ? (
              <LawmindSettingsContentHeader
                title={activeMeta.label}
                description={activeMeta.description}
              />
            ) : null}
            <div key={activeSectionId} className="lm-settings-content-body">
              {sectionBody}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use `LawmindSettingsPage`; kept for existing imports. */
export const LawmindSettingsDialog = LawmindSettingsPage;

type SectionRenderArgs = Omit<Props, "open" | "initialSectionId" | "scrollAnchorId"> & {
  activeSectionId: LawmindSettingsSectionId;
  navigateToSection: (sectionId: LawmindSettingsSectionId) => void;
};

function renderSettingsSection(args: SectionRenderArgs): ReactNode {
  const {
    activeSectionId,
    config,
    projectDir,
    workspaceLabel,
    health,
    healthPayload = null,
    collabSummarySettings,
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    onClose,
    onOpenNewAssistant,
    onOpenEditAssistant,
    onRemoveAssistant,
    onApplyRetrievalMode,
    onApplyDraftWithModelEnabled,
    onReconnectLocalService,
    localServiceReconnecting,
    onOpenApiWizard,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    customModels,
    modelCatalog,
    onModelsChanged,
    onPickProject,
    onClearProject,
    onOpenCollaborationPage,
    onPrefsChange,
    navigateToSection,
  } = args;

  const notReady = (
    <p className="lm-meta lm-settings-empty">本地服务尚未就绪，请稍候或重启应用后再试。</p>
  );

  switch (activeSectionId) {
    case "doctor":
      return (
        <>
          {config ? (
            <>
              <LawmindSettingsOnboarding
                health={health}
                projectDir={projectDir}
                onOpenApiWizard={onOpenApiWizard}
                onNavigateToSection={navigateToSection}
              />
              <LawmindSettingsUsageStats apiBase={config.apiBase} />
              <LawmindSettingsDoctor
                health={healthPayload}
                apiBase={config.apiBase}
                onOpenApiWizard={onOpenApiWizard}
                onOpenCollaborationPage={() => {
                  onClose();
                  onOpenCollaborationPage();
                }}
                onScrollToWorkspace={() => navigateToSection("workspace")}
                onOpenMemorySection={() => navigateToSection("memory")}
              />
            </>
          ) : (
            notReady
          )}
        </>
      );
    case "appearance":
      return <LawmindSettingsAppearance onPrefsChange={onPrefsChange} />;
    case "review-prefs":
      return <LawmindSettingsReviewPrefs />;
    case "memory":
      return config ? <LawmindSettingsMemory apiBase={config.apiBase} /> : notReady;
    case "collaboration":
      return config ? (
        <LawmindSettingsCollaborationBrief
          collabSummarySettings={collabSummarySettings}
          localServiceReconnecting={localServiceReconnecting}
          onReconnectLocalService={onReconnectLocalService}
          onOpenCollaborationPage={() => {
            onClose();
            onOpenCollaborationPage();
          }}
        />
      ) : (
        notReady
      );
    case "assistants":
      return (
        <LawmindSettingsAssistants
          assistants={assistants}
          selectedAssistantId={selectedAssistantId}
          onSelectAssistantId={onSelectAssistantId}
          selectedAssistant={selectedAssistant}
          selectedAssistantStats={selectedAssistantStats}
          onOpenNew={onOpenNewAssistant}
          onOpenEdit={onOpenEditAssistant}
          onRemove={() => void onRemoveAssistant()}
        />
      );
    case "models":
      return config ? (
        <LawmindSettingsModelRetrieval
          config={{
            workspaceDir: config.workspaceDir,
            projectDir: config.projectDir,
            retrievalMode: config.retrievalMode,
          }}
          health={health}
          envFilePath={config.envFilePath}
          retrievalLabel={retrievalLabel}
          retrievalSaving={retrievalSaving}
          draftWithModelSaving={draftWithModelSaving}
          applyRetrievalMode={onApplyRetrievalMode}
          applyDraftWithModelEnabled={onApplyDraftWithModelEnabled}
          apiBase={config.apiBase}
          modelProviders={modelProviders}
          platformProviders={platformProviders}
          platformMode={platformMode}
          selectedModelId={selectedModelId}
          customModels={customModels}
          modelCatalog={modelCatalog}
          onModelsChanged={onModelsChanged}
          onOpenApiWizard={onOpenApiWizard}
        />
      ) : (
        notReady
      );
    case "workspace":
      return config ? (
        <LawmindSettingsWorkspace
          config={{
            workspaceDir: config.workspaceDir,
            projectDir: config.projectDir,
            retrievalMode: config.retrievalMode,
          }}
          workspaceLabel={workspaceLabel}
          projectDir={projectDir}
          onPickProject={() => void onPickProject()}
          onClearProject={() => void onClearProject()}
        />
      ) : (
        notReady
      );
    case "tools":
      return config ? <LawmindSettingsTools apiBase={config.apiBase} /> : notReady;
    case "roles":
      return config ? <LawmindSettingsRoles apiBase={config.apiBase} /> : notReady;
    case "templates":
      return config ? <LawmindSettingsTemplates apiBase={config.apiBase} /> : notReady;
    case "edition":
      return config ? <LawmindSettingsEdition apiBase={config.apiBase} /> : notReady;
    case "app-update":
      return <LawmindSettingsAppUpdate config={config} />;
    case "disclaimer":
      return <LawmindSettingsDisclaimer />;
    default:
      return null;
  }
}
