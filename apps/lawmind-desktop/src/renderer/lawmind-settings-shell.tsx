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
import { LawmindSettingsSkills } from "./LawmindSettingsSkills";
import { LawmindSettingsUsageStats } from "./LawmindSettingsUsageStats";
import { LawmindAutomationsPanel } from "./LawmindAutomationsPanel";
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
import { useEdition } from "./use-edition";

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
    authorityCorpus?: NonNullable<HealthPayload["doctor"]>["authorityCorpus"];
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
  onOpenNewAssistant: (presetKey?: string) => void;
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
  /** Automations (settings section) */
  automationMatterId?: string | null;
  automationMatterOptions?: Array<{ id: string; title: string }>;
  onOpenAutomationsNeedsDecision?: () => void;
  onOpenAutomationsReview?: (taskId: string, matterId?: string) => void;
  onOpenAutomationsCollaboration?: (matterId?: string) => void;
};

function LawmindSettingsContentHeader(props: { title: string; description: string }): ReactNode {
  const { title, description } = props;
  return (
    <header className="lm-settings-content-header">
      <h2 className="lm-settings-content-title">{title}</h2>
      {description.trim() ? <p className="lm-settings-content-desc">{description}</p> : null}
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
  automationMatterId = null,
  automationMatterOptions,
  onOpenAutomationsNeedsDecision,
  onOpenAutomationsReview,
  onOpenAutomationsCollaboration,
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState<LawmindSettingsSectionId>(initialSectionId);
  const [navQuery, setNavQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { edition } = useEdition(config?.apiBase ?? "");
  const collapseAdvancedByDefault = edition === "solo";

  useEffect(() => {
    if (open) {
      setActiveSectionId(initialSectionId);
      setNavQuery("");
      requestAnimationFrame(() => {
        const active = document.querySelector<HTMLElement>(".lm-settings-nav-item.is-active");
        const first = document.querySelector<HTMLElement>(".lm-settings-nav-item");
        (active ?? first)?.focus();
      });
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
    automationMatterId,
    automationMatterOptions,
    onOpenAutomationsNeedsDecision,
    onOpenAutomationsReview,
    onOpenAutomationsCollaboration,
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
              filteredGroups.map((group) => {
                const items = group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`lm-settings-nav-item${activeSectionId === item.id ? " is-active" : ""}`}
                    aria-current={activeSectionId === item.id ? "page" : undefined}
                    data-testid={`lm-settings-nav-${item.id}`}
                    onClick={() => navigateToSection(item.id)}
                  >
                    <span className="lm-settings-nav-item-label">{item.label}</span>
                    {navSearching ? (
                      <span className="lm-settings-nav-item-hint">{item.description}</span>
                    ) : null}
                  </button>
                ));
                const collapseAdvanced =
                  group.id === "advanced" && collapseAdvancedByDefault && !navSearching;
                if (collapseAdvanced) {
                  const forceOpen = group.items.some((item) => item.id === activeSectionId);
                  return (
                    <details
                      key={group.id}
                      className="lm-settings-nav-group lm-settings-nav-group--collapsible"
                      data-testid="lm-settings-nav-advanced"
                      {...(forceOpen ? { open: true } : {})}
                    >
                      <summary className="lm-settings-nav-group-label">{group.label}</summary>
                      {items}
                    </details>
                  );
                }
                return (
                  <div key={group.id} className="lm-settings-nav-group" data-testid={`lm-settings-nav-group-${group.id}`}>
                    <div className="lm-settings-nav-group-label">{group.label}</div>
                    {items}
                  </div>
                );
              })
            )}
          </nav>
          <footer className="lm-settings-sidebar-footer">
            <button
              type="button"
              className="lm-settings-sidebar-btn lm-settings-sidebar-btn--back"
              onClick={onClose}
              aria-label="关闭设置并返回工作台"
              data-testid="lm-settings-sidebar-back"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M9.75 3.5 5.25 8l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              返回工作台
            </button>
            <span className="lm-settings-sidebar-version" title="LawMind 桌面版">
              v{config?.appVersion?.trim() || "dev"}
            </span>
            <button
              type="button"
              className="lm-settings-sidebar-btn lm-settings-sidebar-btn--update"
              onClick={() => navigateToSection("app-update")}
              aria-label="检查应用更新"
              data-testid="lm-settings-sidebar-update"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 2.75v6.5M5.5 6.75 8 9.25l2.5-2.5M3.25 12.5h9.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
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
    automationMatterId,
    automationMatterOptions,
    onOpenAutomationsNeedsDecision,
    onOpenAutomationsReview,
    onOpenAutomationsCollaboration,
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
    case "automations":
      return config?.apiBase ? (
        <LawmindAutomationsPanel
          apiBase={config.apiBase}
          matterId={automationMatterId}
          matterOptions={automationMatterOptions}
          hideTitleChrome
          onOpenNeedsDecisionDesk={onOpenAutomationsNeedsDecision}
          onOpenReview={onOpenAutomationsReview}
          onOpenCollaboration={onOpenAutomationsCollaboration}
        />
      ) : (
        notReady
      );
    case "assistants":
      return (
        <LawmindSettingsAssistants
          apiBase={config?.apiBase}
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
          apiBase={config.apiBase}
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
    case "skills":
      return config ? <LawmindSettingsSkills apiBase={config.apiBase} /> : notReady;
    case "roles":
      return config ? <LawmindSettingsRoles apiBase={config.apiBase} /> : notReady;
    case "templates":
      return config ? (
        <LawmindSettingsTemplates apiBase={config.apiBase} projectDir={projectDir} />
      ) : (
        notReady
      );
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
