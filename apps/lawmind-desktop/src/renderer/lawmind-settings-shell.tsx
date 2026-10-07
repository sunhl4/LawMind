import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LawmindSettingsAccount } from "./LawmindSettingsAccount";
import { checkDesktopUpdates, openDesktopDownloadPage } from "./LawmindSettingsAppUpdate";
import { LawmindSettingsAssistants } from "./LawmindSettingsAssistants";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsCollaborationBrief } from "./LawmindSettingsCollaboration";
import { LawmindCollaborationDesk } from "./LawmindCollaborationDesk";
import { LawmindSettingsDisclaimer } from "./LawmindSettingsDisclaimer";
import { LawmindSettingsEdition } from "./LawmindSettingsEdition";
import { LawmindSettingsModelRetrieval } from "./LawmindSettingsModelRetrieval";
import { LawmindSettingsRoles } from "./LawmindSettingsRoles";
import { LawmindSettingsAppearance } from "./LawmindSettingsAppearance";
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";
import { LawmindSettingsMemory } from "./LawmindSettingsMemory";
import { LawmindSettingsSkills } from "./LawmindSettingsSkills";
import { LawmindAutomationsPanel } from "./LawmindAutomationsPanel";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { CollabEvent, DelegationRow, GateHistoryItem, HealthPayload } from "./lawmind-app-data";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import {
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  type LawmindSettingsScrollAnchorId,
  type LawmindSettingsSectionId,
  firstSettingsNavMatch,
  settingsNavItem,
  settingsNavItemsForEdition,
  writeStoredSettingsSection,
} from "./lawmind-settings-nav";
import { LAWMIND_DOWNLOAD_PAGE_URL } from "./lawmind-public-urls.js";
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
export { clearProjectDirectory } from "./lawmind-settings-project";

export type SetShowSettings = (
  open: boolean | ((prev: boolean) => boolean),
  sectionId?: LawmindSettingsSectionId,
  scrollAnchorId?: LawmindSettingsScrollAnchorId,
) => void;

type Props = {
  open: boolean;
  initialSectionId?: LawmindSettingsSectionId;
  scrollAnchorId?: LawmindSettingsScrollAnchorId;
  config: AppConfig | null;
  projectDir: string | null;
  workspaceLabel: string;
  health: {
    modelConfigured: boolean;
    modelVerified?: boolean;
    retrievalMode?: string;
    dualLegalConfigured?: boolean;
    webSearchApiKeyConfigured?: boolean;
    webSearchNativeAvailable?: boolean;
    webSearchReady?: boolean;
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
  onDuplicateAssistant: () => void | Promise<void>;
  onPatchAssistantRoster: (
    assistantId: string,
    patch: { pinned?: boolean; hidden?: boolean },
  ) => void | Promise<void>;
  onApplyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  onApplyDraftWithModelEnabled?: (enabled: boolean) => void | Promise<void>;
  npcSaving?: boolean;
  onApplyOpenLawNpc?: (enabled: boolean) => void | Promise<void>;
  authoritySaving?: boolean;
  onSaveAuthority?: (payload: import("./LawmindAuthoritySetup").AuthoritySavePayload) => Promise<void>;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
  onOpenApiWizard: () => void;
  onVerifyModel?: () => void | Promise<void>;
  platformProviders?: import("./lawmind-models-api").PlatformProviderKeyStatus[];
  platformMode?: "proxy" | "platform_key" | "none";
  selectedModelId?: string;
  customModels?: ModelCatalogEntry[];
  modelCatalog?: ModelCatalogEntry[];
  onModelsChanged?: () => void | Promise<void>;
  onPickProject: () => void | Promise<void>;
  onClearProject: () => void | Promise<void>;
  onOpenArchiveOrganize?: () => void;
  onOpenCollaborationPage: () => void;
  delegations?: DelegationRow[];
  collabEvents?: CollabEvent[];
  gateHistory?: GateHistoryItem[];
  formatRelativeTime?: (iso: string) => string;
  onRefreshCollaboration?: () => void | Promise<void>;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  assistantDisplayById?: Record<string, string>;
  workflowModelLabel?: string;
  onPrefsChange?: () => void;
  /** Automations (settings section) */
  automationMatterId?: string | null;
  automationMatterOptions?: Array<{ id: string; title: string }>;
  onOpenAutomationsNeedsDecision?: (
    target?: import("./lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  onOpenAutomationsReview?: (taskId: string, matterId?: string) => void;
  onOpenAutomationsCollaboration?: (matterId?: string, jobId?: string) => void;
  onOpenAutomationsWorkspaceFile?: (relPath: string, matterId?: string) => void;
};

function normalizeSettingsSection(sectionId: LawmindSettingsSectionId): LawmindSettingsSectionId {
  if (sectionId === "doctor") {
    return "workspace";
  }
  if (sectionId === "app-update") {
    return "account";
  }
  return sectionId;
}

function SettingsNavIcon(props: { id: LawmindSettingsSectionId }): ReactNode {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true as const,
  };
  switch (props.id) {
    case "account":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.15" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="6.55" r="1.35" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M4.85 11.35c.4-1.35 1.55-2.05 3.15-2.05s2.75.7 3.15 2.05"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "models":
      return (
        <svg {...common}>
          <path
            d="M8 2.15 13.15 5.05v5.9L8 13.85 2.85 10.95v-5.9L8 2.15Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M8 8.05 13.15 5.05M8 8.05 2.85 5.05M8 8.05v5.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "workspace":
      return (
        <svg {...common}>
          <path
            d="M2.2 4.15h4.05l1.25 1.35h6.3v6.55H2.2V4.15Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "appearance":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.15" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 2.85a5.15 5.15 0 0 0 0 10.3V2.85Z" fill="currentColor" />
        </svg>
      );
    case "automations":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.15" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 5.05V8.1l2.05 1.35"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "memory":
      return (
        <svg {...common}>
          <path
            d="M4.15 2.7h7.7v10.6L8 10.55 4.15 13.3V2.7Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "assistants":
      return (
        <svg {...common}>
          <circle cx="8" cy="5.35" r="2.05" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M3.25 12.85c.55-2.15 2.25-3.2 4.75-3.2s4.2 1.05 4.75 3.2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "disclaimer":
      return (
        <svg {...common}>
          <path
            d="M4.15 2.55h5.05L12.1 5.4v8.05H4.15V2.55Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M9.05 2.7v2.85h2.85M6.05 8.15h4.1M6.05 10.35h2.9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "app-update":
      return (
        <svg {...common}>
          <path
            d="M8 2.7v6.2M5.55 6.55 8 9l2.45-2.45M3.2 12.45h9.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}

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
  onDuplicateAssistant,
  onPatchAssistantRoster,
  onApplyRetrievalMode,
  onApplyDraftWithModelEnabled,
  npcSaving = false,
  onApplyOpenLawNpc,
  authoritySaving = false,
  onSaveAuthority,
  onReconnectLocalService,
  localServiceReconnecting = false,
  onOpenApiWizard,
  onVerifyModel,
  platformProviders,
  platformMode,
  selectedModelId,
  customModels,
  modelCatalog = customModels,
  onModelsChanged,
  onPickProject,
  onClearProject,
  onOpenArchiveOrganize,
  onOpenCollaborationPage,
  onPrefsChange,
  automationMatterId = null,
  automationMatterOptions,
  onOpenAutomationsNeedsDecision,
  onOpenAutomationsReview,
  onOpenAutomationsCollaboration,
  onOpenAutomationsWorkspaceFile,
}: Props) {
  const openedSection = normalizeSettingsSection(initialSectionId);
  const [activeSectionId, setActiveSectionId] = useState<LawmindSettingsSectionId>(openedSection);
  const [navQuery, setNavQuery] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { edition } = useEdition(config?.apiBase ?? "");

  useEffect(() => {
    if (open) {
      setActiveSectionId(normalizeSettingsSection(initialSectionId));
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
      return undefined;
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
      return undefined;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(scrollAnchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, scrollAnchorId, activeSectionId]);

  const filteredItems = useMemo(
    () => settingsNavItemsForEdition(edition, navQuery),
    [edition, navQuery],
  );
  const activeMeta =
    settingsNavItem(activeSectionId) ??
    (activeSectionId === "review-prefs" ? settingsNavItem("appearance") : undefined);
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
    allowMultiAssistantRoster: edition === "firm" || edition === "private_deploy",
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    onClose,
    onOpenNewAssistant,
    onOpenEditAssistant,
    onRemoveAssistant,
    onDuplicateAssistant,
    onPatchAssistantRoster,
    onApplyRetrievalMode,
    onApplyDraftWithModelEnabled,
    npcSaving,
    onApplyOpenLawNpc,
    authoritySaving,
    onSaveAuthority,
    onReconnectLocalService,
    localServiceReconnecting,
    onOpenApiWizard,
    onVerifyModel,
    platformProviders,
    platformMode,
    selectedModelId,
    customModels,
    modelCatalog,
    onModelsChanged,
    onPickProject,
    onClearProject,
    onOpenArchiveOrganize,
    onOpenCollaborationPage,
    onPrefsChange,
    automationMatterId,
    automationMatterOptions,
    onOpenAutomationsNeedsDecision,
    onOpenAutomationsReview,
    onOpenAutomationsCollaboration,
    onOpenAutomationsWorkspaceFile,
    navigateToSection,
  });

  return (
    <div className="lm-settings-page" role="region" aria-label="设置">
      <div className="lm-settings-layout">
        <aside className="lm-settings-sidebar" aria-label="设置分类">
          <div className="lm-settings-nav-search">
            <div className="lm-settings-nav-search-field">
              <svg
                className="lm-settings-nav-search-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.2 10.2 13.2 13.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                className="lm-settings-nav-search-input"
                placeholder="搜索设置"
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                aria-label="搜索设置项"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") {
                    return;
                  }
                  e.preventDefault();
                  const query = navQuery.trim();
                  if (!query) {
                    return;
                  }
                  const match = firstSettingsNavMatch(query, edition);
                  if (match) {
                    navigateToSection(match);
                    setNavQuery("");
                  }
                }}
              />
            </div>
          </div>
          <nav className="lm-settings-nav" aria-label="设置分类列表">
            {filteredItems.length === 0 ? (
              <p className="lm-meta lm-settings-nav-empty">无匹配项</p>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`lm-settings-nav-item${activeSectionId === item.id ? " is-active" : ""}`}
                  aria-current={activeSectionId === item.id ? "page" : undefined}
                  data-testid={`lm-settings-nav-${item.id}`}
                  onClick={() => navigateToSection(item.id)}
                >
                  <span className="lm-settings-nav-item-icon">
                    <SettingsNavIcon id={item.id} />
                  </span>
                  <span className="lm-settings-nav-item-copy">
                    <span className="lm-settings-nav-item-label">{item.label}</span>
                    {navSearching ? (
                      <span className="lm-settings-nav-item-hint">{item.description}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </nav>
          <footer className="lm-settings-sidebar-footer">
            <span className="lm-settings-sidebar-version" title="LawMind 桌面版">
              v{config?.appVersion?.trim() || "dev"}
            </span>
            <button
              type="button"
              className="lm-settings-sidebar-btn lm-settings-sidebar-btn--update"
              disabled={updateBusy}
              title={
                config?.packaged
                  ? "检查桌面版更新"
                  : "当前不是正式安装包，打开下载页"
              }
              onClick={() => {
                if (config?.packaged) {
                  setUpdateBusy(true);
                  void checkDesktopUpdates().finally(() => setUpdateBusy(false));
                  return;
                }
                openDesktopDownloadPage(config?.downloadPageUrl?.trim() || LAWMIND_DOWNLOAD_PAGE_URL);
              }}
              aria-label={config?.packaged ? "检查应用更新" : "打开下载页"}
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
              {updateBusy ? "检查中…" : "更新"}
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
  allowMultiAssistantRoster: boolean;
};

function renderSettingsSection(args: SectionRenderArgs): ReactNode {
  const {
    activeSectionId,
    config,
    projectDir,
    workspaceLabel,
    health,
    collabSummarySettings,
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    onOpenNewAssistant,
    onOpenEditAssistant,
    onRemoveAssistant,
    onDuplicateAssistant,
    onPatchAssistantRoster,
    allowMultiAssistantRoster,
    onApplyRetrievalMode,
    onApplyDraftWithModelEnabled,
    npcSaving,
    onApplyOpenLawNpc,
    authoritySaving,
    onSaveAuthority,
    onReconnectLocalService,
    localServiceReconnecting,
    onOpenApiWizard,
    platformProviders,
    platformMode,
    selectedModelId,
    customModels,
    modelCatalog,
    onModelsChanged,
    onPickProject,
    onClearProject,
    onOpenArchiveOrganize,
    onPrefsChange,
    automationMatterId,
    automationMatterOptions,
    onOpenAutomationsNeedsDecision,
    navigateToSection,
  } = args;

  const notReady = (
    <p className="lm-meta lm-settings-empty">本地服务尚未就绪，请稍候或重启应用后再试。</p>
  );

  switch (normalizeSettingsSection(activeSectionId === "tools" ? "models" : activeSectionId)) {
    case "account":
      return (
        <LawmindSettingsAccount
          apiBase={config?.apiBase}
          license={args.healthPayload?.doctor?.license}
          platformMode={platformMode}
          modelConfigured={health?.modelConfigured}
          modelName={health?.modelName}
          onOpenModels={() => navigateToSection("models")}
        />
      );
    case "doctor":
      return null;
    case "appearance":
    case "review-prefs":
      return (
        <LawmindSettingsAppearance apiBase={config?.apiBase} onPrefsChange={onPrefsChange} />
      );
    case "memory":
      return config ? <LawmindSettingsMemory apiBase={config.apiBase} /> : notReady;
    case "collaboration":
      return config && collabSummarySettings ? (
        <>
          <LawmindSettingsCollaborationBrief
            collabSummarySettings={collabSummarySettings}
            localServiceReconnecting={localServiceReconnecting}
            onReconnectLocalService={onReconnectLocalService}
          />
          <SettingsCollaborationDeskHost {...args} />
        </>
      ) : (
        notReady
      );
    case "automations":
      return config?.apiBase ? (
        <LawmindAutomationsPanel
          apiBase={config.apiBase}
          matterId={automationMatterId}
          matterOptions={automationMatterOptions}
          assistantId={selectedAssistantId}
          hideTitleChrome
          onOpenNeedsDecisionDesk={onOpenAutomationsNeedsDecision}
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
          onDuplicate={() => void onDuplicateAssistant()}
          onPatchRoster={(assistantId, patch) => void onPatchAssistantRoster(assistantId, patch)}
          allowMultiAssistantRoster={allowMultiAssistantRoster}
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
          npcSaving={npcSaving}
          applyOpenLawNpc={onApplyOpenLawNpc}
          authoritySaving={authoritySaving}
          onSaveAuthority={onSaveAuthority}
          apiBase={config.apiBase}
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
          onOpenArchiveOrganize={onOpenArchiveOrganize}
        />
      ) : (
        notReady
      );
    case "skills":
      return config ? <LawmindSettingsSkills apiBase={config.apiBase} /> : notReady;
    case "roles":
      return config ? <LawmindSettingsRoles apiBase={config.apiBase} /> : notReady;
    case "templates":
      return (
        <div className="lm-settings-section" data-testid="lm-settings-templates-retired">
          <p className="lm-settings-caption">
            出稿用软件里的内置模板。不能在这里上传，以免解析失败。我们会继续在后台增加模板。
          </p>
        </div>
      );
    case "edition":
      return config ? <LawmindSettingsEdition apiBase={config.apiBase} /> : notReady;
    case "disclaimer":
      return <LawmindSettingsDisclaimer />;
    default:
      return null;
  }
}

function SettingsCollaborationDeskHost(props: SectionRenderArgs): ReactNode {
  const [tab, setTab] = useState<"overview" | "workflows">("overview");
  if (
    !props.config ||
    !props.delegations ||
    !props.collabEvents ||
    !props.gateHistory ||
    !props.formatRelativeTime ||
    !props.onRefreshCollaboration ||
    !props.collabSummarySettings
  ) {
    return null;
  }
  return (
    <LawmindCollaborationDesk
      config={props.config}
      collabSummarySettings={props.collabSummarySettings}
      selectedAssistantId={props.selectedAssistantId}
      delegations={props.delegations}
      collabEvents={props.collabEvents}
      gateHistory={props.gateHistory}
      formatRelativeTime={props.formatRelativeTime}
      onRefreshCollaboration={props.onRefreshCollaboration}
      onOpenDelegationTargetChat={props.onOpenDelegationTargetChat}
      deskTab={tab}
      onDeskTabChange={setTab}
      assistantDisplayById={props.assistantDisplayById}
      workflowModelLabel={props.workflowModelLabel}
      onReconnectLocalService={props.onReconnectLocalService}
      localServiceReconnecting={props.localServiceReconnecting}
    />
  );
}
