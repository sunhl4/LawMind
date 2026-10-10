import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  type RootKey,
  type FsEntry,
  type OpenFileTab,
  type IndexedFile,
  type ContextMenu,
  type ConfirmDialog,
  type InlineInput,
  type FsClip,
  type FilePortalHosts,
  type FileWorkbenchCasesNodeActions,
} from "./file-workbench-types";
import { QuickOpenModal } from "./file-workbench-fs";
import { FileWorkbenchDialogs } from "./FileWorkbenchDialogs";
import { FileWorkbenchContextMenu } from "./FileWorkbenchContextMenu";
import { FileWorkbenchTree } from "./FileWorkbenchTree";
import { FileWorkbenchEditorPane } from "./FileWorkbenchEditorPane";

export type FileWorkbenchViewModel = {
  workspaceDir: string;
  projectDir: string | null;
  onPickProject?: () => void | Promise<void>;
  canUseFilesystemBridge: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  addToContextLabel?: string;
  portalHosts?: FilePortalHosts | null;
  workspaceExplorerToolbar?: ReactNode;
  casesNodeActions?: FileWorkbenchCasesNodeActions | null;
  mattersPickList?: Array<{ id: string; label: string }> | null;
  childrenByDir: Record<string, FsEntry[]>;
  expanded: Record<string, boolean>;
  selected: { root: RootKey; path: string; kind: "file" | "directory" } | null;
  setSelected: React.Dispatch<React.SetStateAction<{ root: RootKey; path: string; kind: "file" | "directory" } | null>>;
  tabs: OpenFileTab[];
  activeTabId: string | null;
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  contextMenu: ContextMenu | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenu | null>>;
  confirmDialog: ConfirmDialog | null;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialog | null>>;
  inlineInput: InlineInput | null;
  setInlineInput: React.Dispatch<React.SetStateAction<InlineInput | null>>;
  dangerInput: string;
  setDangerInput: React.Dispatch<React.SetStateAction<string>>;
  showQuickOpen: boolean;
  setShowQuickOpen: React.Dispatch<React.SetStateAction<boolean>>;
  indexedFiles: IndexedFile[];
  fsClip: FsClip | null;
  addToMatterPick: { relPath: string; kind: "file" | "directory" } | null;
  setAddToMatterPick: React.Dispatch<React.SetStateAction<{ relPath: string; kind: "file" | "directory" } | null>>;
  addToMatterManualDraft: string;
  setAddToMatterManualDraft: React.Dispatch<React.SetStateAction<string>>;
  addToMatterLastError: string | null;
  setAddToMatterLastError: React.Dispatch<React.SetStateAction<string | null>>;
  casesDirProbe: "unknown" | "ok" | "missing";
  workSectionOpen: boolean;
  setWorkSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  casesSectionOpen: boolean;
  setCasesSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  explorerMatterId?: string | null;
  filesExplorerWidth: number;
  onFilesExplorerResize: (e: React.PointerEvent) => void;
  explorerUsesRailLayout: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  inlineInputRef: React.RefObject<HTMLInputElement | null>;
  activeTab: OpenFileTab | null | undefined;
  activeDirty: boolean;
  toggleDir: (root: RootKey, dirPath: string) => void | Promise<void>;
  openFile: (root: RootKey, path: string) => void | Promise<void>;
  closeTab: (id: string) => void;
  updateActiveContent: (content: string) => void;
  saveActive: () => void | Promise<void>;
  saveActiveAs: () => void | Promise<void>;
  startCreate: (root: RootKey, parentDir: string, kind: "file" | "folder") => void;
  startRename: (root: RootKey, relPath: string) => void;
  requestDelete: (root: RootKey, relPath: string, kind: "file" | "directory") => void;
  doShowInFolder: (root: RootKey, relPath: string) => void | Promise<void>;
  pasteInto: (root: RootKey, parentDir: string) => void | Promise<void>;
  moveWorkspaceItemIntoMatter: (
    matterId: string,
    relPath: string,
    kind: "file" | "directory",
  ) => void | Promise<void>;
  copyPath: (root: RootKey, relPath: string) => void;
  cutPath: (root: RootKey, relPath: string) => void;
  refreshDir: (root: RootKey, dirPath: string) => void | Promise<void>;
};

export function FileWorkbenchView(vm: FileWorkbenchViewModel) {
  const {
    workspaceDir,
    projectDir,
    onPickProject,
    canUseFilesystemBridge,
    onAddToChatContext,
    addToContextLabel,
    portalHosts,
    workspaceExplorerToolbar,
    casesNodeActions,
    mattersPickList,
    childrenByDir,
    expanded,
    selected,
    setSelected,
    tabs,
    activeTabId,
    setActiveTabId,
    busy,
    error,
    setError,
    contextMenu,
    setContextMenu,
    confirmDialog,
    setConfirmDialog,
    inlineInput,
    setInlineInput,
    dangerInput,
    setDangerInput,
    showQuickOpen,
    setShowQuickOpen,
    indexedFiles,
    fsClip,
    addToMatterPick,
    setAddToMatterPick,
    addToMatterManualDraft,
    setAddToMatterManualDraft,
    addToMatterLastError,
    setAddToMatterLastError,
    casesDirProbe,
    workSectionOpen,
    setWorkSectionOpen,
    casesSectionOpen,
    setCasesSectionOpen,
    explorerMatterId = null,
    filesExplorerWidth,
    onFilesExplorerResize,
    explorerUsesRailLayout,
    menuRef,
    inlineInputRef,
    activeTab,
    activeDirty,
    toggleDir,
    openFile,
    closeTab,
    updateActiveContent,
    saveActive,
    saveActiveAs,
    startCreate,
    startRename,
    requestDelete,
    doShowInFolder,
    pasteInto,
    moveWorkspaceItemIntoMatter,
    copyPath,
    cutPath,
    refreshDir,
  } = vm;

  const treeProps = {
    childrenByDir,
    expanded,
    selected,
    setSelected,
    inlineInput,
    setInlineInput,
    inlineInputRef,
    casesNodeActions,
    onAddToChatContext,
    toggleDir,
    openFile,
    setContextMenu,
  };

  const renderExplorerSectionHeader = (opts: {
    label: string;
    root: RootKey;
    menuPath: string;
    sectionOpen: boolean;
    setSectionOpen: (v: boolean) => void;
    onAddFile: () => void;
    addTitle: string;
  }) => (
    <div className="lm-fs-dual-root-header">
      <button
        type="button"
        className="lm-fs-dual-expander"
        aria-expanded={opts.sectionOpen}
        aria-label={`${opts.sectionOpen ? "折叠" : "展开"}${opts.label}`}
        title={opts.sectionOpen ? "折叠" : "展开"}
        onClick={() => opts.setSectionOpen(!opts.sectionOpen)}
      >
        <span className={`lm-fs-arrow ${opts.sectionOpen ? "open" : ""}`}>▸</span>
      </button>
      <div
        className="lm-fs-dual-header-body"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.setSectionOpen(!opts.sectionOpen);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            root: opts.root,
            path: opts.menuPath,
            kind: "directory",
            isRoot: opts.menuPath === "",
          });
        }}
        onClick={() => opts.setSectionOpen(!opts.sectionOpen)}
      >
        <span className="lm-section-label">{opts.label}</span>
      </div>
      <button type="button" className="lm-fs-root-add" title={opts.addTitle} onClick={() => opts.onAddFile()}>
        ＋
      </button>
    </div>
  );

  const explorerClassName =
    `lm-files-explorer ${portalHosts ? (explorerUsesRailLayout ? "lm-file-explorer-rail" : "lm-file-explorer-embedded") : ""}`.trim();
  const explorerStyle = explorerUsesRailLayout
    ? { width: filesExplorerWidth, flexShrink: 0 }
    : { width: "100%", minHeight: 0, flex: 1 };
  const renderQuickOpenTrigger = () =>
    workSectionOpen || casesSectionOpen ? (
      <button type="button" className="lm-quickopen-trigger" onClick={() => setShowQuickOpen(true)}>
        <span>🔍</span>
        <span>在材料中搜索…</span>
        <kbd>⌘P</kbd>
      </button>
    ) : null;
  const renderWorkSection = () => (
    <div className="lm-fs-section lm-fs-section-dual" data-testid="lm-fs-local-folder-section">
      {renderExplorerSectionHeader({
        label: "工作区",
        root: "project",
        menuPath: "",
        sectionOpen: workSectionOpen,
        setSectionOpen: setWorkSectionOpen,
        onAddFile: () => {
          if (!projectDir) {
            void onPickProject?.();
            return;
          }
          startCreate("project", "", "file");
        },
        addTitle: projectDir ? "在本机文件夹中新建文件" : "选择本机文件夹",
      })}
      {workSectionOpen ? (
        projectDir ? (
          <>
            <p className="lm-fs-dual-path lm-meta" title={projectDir}>
              {projectDir}
            </p>
            <FileWorkbenchTree root="project" dirPath="" {...treeProps} />
          </>
        ) : (
          <div className="lm-fs-dual-empty">
            <p>尚未选择本机文件夹。这里只显示您电脑上的材料，不会展示软件内部目录。</p>
            {onPickProject ? (
              <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={() => void onPickProject()}>
                选择本机文件夹…
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
  const renderCasesSection = () => (
    <div className="lm-fs-section lm-fs-section-dual" data-testid="lm-fs-cases-section">
      {renderExplorerSectionHeader({
        label: explorerMatterId ? "本案材料" : "案件材料",
        root: "workspace",
        menuPath: explorerMatterId ? `cases/${explorerMatterId}` : "cases",
        sectionOpen: casesSectionOpen,
        setSectionOpen: setCasesSectionOpen,
        onAddFile: () =>
          startCreate("workspace", explorerMatterId ? `cases/${explorerMatterId}` : "cases", "file"),
        addTitle: explorerMatterId ? "在本案材料中新建文件" : "在案件材料区新建文件",
      })}
      {casesSectionOpen ? (
        casesDirProbe === "missing" &&
        !explorerMatterId &&
        !(
          inlineInput?.root === "workspace" &&
          inlineInput.parentDir === "cases" &&
          inlineInput.kind === "folder"
        ) ? (
          <p className="lm-fs-dual-empty">右键新建案件。</p>
        ) : (
          <FileWorkbenchTree
            root="workspace"
            dirPath={explorerMatterId ? `cases/${explorerMatterId}` : "cases"}
            {...treeProps}
          />
        )
      ) : null}
    </div>
  );
  const renderExplorerError = () =>
    error ? (
      <div className="lm-callout lm-callout-danger lm-error--explorer" role="alert">
        <p className="lm-callout-body">{error}</p>
        <button type="button" className="lm-error-dismiss" aria-label="关闭错误提示" onClick={() => setError(null)}>
          ×
        </button>
      </div>
    ) : null;
  const renderToolbar = () =>
    workspaceExplorerToolbar ? (
      <div className="lm-fs-workspace-toolbar" role="toolbar" aria-label="工作台文件">
        {workspaceExplorerToolbar}
      </div>
    ) : null;
  const splitExplorerHosts = Boolean(portalHosts?.explorer && portalHosts.explorerCases);
  const explorerAside = splitExplorerHosts ? null : (
    <aside
      className={explorerClassName}
      style={explorerStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {renderToolbar()}
      {renderQuickOpenTrigger()}
      <div className="lm-files-explorer-scroll" data-testid="lm-files-explorer-scroll">
        {renderWorkSection()}
        {renderCasesSection()}
        {renderExplorerError()}
      </div>
    </aside>
  );
  const workExplorerAside = (
    <aside
      className={`${explorerClassName} lm-files-explorer--work`.trim()}
      style={explorerStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {renderToolbar()}
      {workSectionOpen ? renderQuickOpenTrigger() : null}
      <div className="lm-files-explorer-scroll" data-testid="lm-files-explorer-scroll-work">
        {renderWorkSection()}
      </div>
    </aside>
  );
  const casesExplorerAside = (
    <aside
      className={`${explorerClassName} lm-files-explorer--cases`.trim()}
      style={explorerStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {casesSectionOpen && !workSectionOpen ? renderQuickOpenTrigger() : null}
      <div className="lm-files-explorer-scroll" data-testid="lm-files-explorer-scroll-cases">
        {renderCasesSection()}
        {renderExplorerError()}
      </div>
    </aside>
  );

  const splitBetweenExplorerAndRest = (
    <div
      className="lm-split-handle lm-split-handle-vertical lm-file-rail-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整资源管理器宽度"
      title="拖动调整资源管理器宽度"
      onPointerDown={onFilesExplorerResize}
    />
  );

  const editorSection = (
    <FileWorkbenchEditorPane
      tabs={tabs}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      activeTab={activeTab}
      activeDirty={activeDirty}
      busy={busy}
      onAddToChatContext={onAddToChatContext}
      setError={setError}
      closeTab={closeTab}
      updateActiveContent={updateActiveContent}
      saveActive={saveActive}
      saveActiveAs={saveActiveAs}
      doShowInFolder={doShowInFolder}
      apiBase={casesNodeActions?.apiBase}
      workspaceDir={workspaceDir}
      projectDir={projectDir}
    />
  );

  const floatingLayer = (
    <>
      <FileWorkbenchContextMenu
        menuRef={menuRef}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        casesNodeActions={casesNodeActions}
        fsClip={fsClip}
        canUseFilesystemBridge={canUseFilesystemBridge}
        busy={busy}
        onAddToChatContext={onAddToChatContext}
        addToContextLabel={addToContextLabel}
        setAddToMatterManualDraft={setAddToMatterManualDraft}
        setAddToMatterLastError={setAddToMatterLastError}
        setAddToMatterPick={setAddToMatterPick}
        startCreate={startCreate}
        pasteInto={pasteInto}
        copyPath={copyPath}
        cutPath={cutPath}
        startRename={startRename}
        requestDelete={requestDelete}
        doShowInFolder={doShowInFolder}
        refreshDir={refreshDir}
      />
      <FileWorkbenchDialogs
        busy={busy}
        mattersPickList={mattersPickList}
        confirmDialog={confirmDialog}
        setConfirmDialog={setConfirmDialog}
        dangerInput={dangerInput}
        setDangerInput={setDangerInput}
        addToMatterPick={addToMatterPick}
        setAddToMatterPick={setAddToMatterPick}
        addToMatterManualDraft={addToMatterManualDraft}
        setAddToMatterManualDraft={setAddToMatterManualDraft}
        addToMatterLastError={addToMatterLastError}
        setAddToMatterLastError={setAddToMatterLastError}
        moveWorkspaceItemIntoMatter={moveWorkspaceItemIntoMatter}
      />
      {showQuickOpen && (
        <QuickOpenModal
          files={indexedFiles}
          onOpen={(root, path) => void openFile(root, path)}
          onClose={() => setShowQuickOpen(false)}
        />
      )}
    </>
  );

  if (portalHosts?.explorer && portalHosts.explorerCases) {
    return (
      <>
        {createPortal(workExplorerAside, portalHosts.explorer)}
        {createPortal(casesExplorerAside, portalHosts.explorerCases)}
        {portalHosts.split ? createPortal(splitBetweenExplorerAndRest, portalHosts.split) : null}
        {portalHosts.editor ? createPortal(editorSection, portalHosts.editor) : null}
        {floatingLayer}
      </>
    );
  }

  if (portalHosts?.explorer && explorerAside) {
    return (
      <>
        {createPortal(explorerAside, portalHosts.explorer)}
        {portalHosts.split ? createPortal(splitBetweenExplorerAndRest, portalHosts.split) : null}
        {portalHosts.editor ? createPortal(editorSection, portalHosts.editor) : null}
        {floatingLayer}
      </>
    );
  }

  return (
    <div className="lm-files-layout">
      {explorerAside}
      {splitBetweenExplorerAndRest}
      {editorSection}
      {floatingLayer}
    </div>
  );
}
