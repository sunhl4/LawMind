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
  officeBlock: { root: RootKey; relPath: string; name: string; mode?: "office" | "binary" } | null;
  setOfficeBlock: React.Dispatch<
    React.SetStateAction<{ root: RootKey; relPath: string; name: string; mode?: "office" | "binary" } | null>
  >;
  imagePreview: { root: RootKey; relPath: string; name: string; dataUrl: string } | null;
  setImagePreview: React.Dispatch<
    React.SetStateAction<{ root: RootKey; relPath: string; name: string; dataUrl: string } | null>
  >;
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
    officeBlock,
    setOfficeBlock,
    imagePreview,
    setImagePreview,
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

  const explorerAside = (
    <aside
      className={`lm-files-explorer ${portalHosts ? (explorerUsesRailLayout ? "lm-file-explorer-rail" : "lm-file-explorer-embedded") : ""}`.trim()}
      style={
        explorerUsesRailLayout
          ? { width: filesExplorerWidth, flexShrink: 0 }
          : { width: "100%", minHeight: 0, flex: 1 }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {workspaceExplorerToolbar ? (
        <div className="lm-fs-workspace-toolbar" role="toolbar" aria-label="工作台文件">
          {workspaceExplorerToolbar}
        </div>
      ) : null}
      <button
        type="button"
        className="lm-quickopen-trigger"
        onClick={() => setShowQuickOpen(true)}
      >
        <span>🔍</span>
        <span>在材料中搜索…</span>
        <kbd>⌘P</kbd>
      </button>

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

      <div className="lm-fs-section lm-fs-section-dual">
        {renderExplorerSectionHeader({
          label: "案件材料",
          root: "workspace",
          menuPath: "cases",
          sectionOpen: casesSectionOpen,
          setSectionOpen: setCasesSectionOpen,
          onAddFile: () => startCreate("workspace", "cases", "file"),
          addTitle: "在案件材料区新建文件",
        })}
        {casesSectionOpen ? (
          casesDirProbe === "missing" &&
          !(
            inlineInput?.root === "workspace" &&
            inlineInput.parentDir === "cases" &&
            inlineInput.kind === "folder"
          ) ? (
            <p className="lm-fs-dual-empty">
              还没有案件。需要办案时，在本区标题上右键「新建案件…」即可；平时写文档可直接用上方「工作区」的本机文件夹。
            </p>
          ) : (
            <FileWorkbenchTree root="workspace" dirPath="cases" {...treeProps} />
          )
        ) : null}
      </div>

      {!portalHosts?.editor && imagePreview ? (
        <div className="lm-fs-side-preview" data-testid="lm-fs-image-preview-side">
          <div className="lm-fs-side-preview-head">
            <strong className="lm-fs-side-preview-title">{imagePreview.name}</strong>
            <button
              type="button"
              className="lm-error-dismiss"
              aria-label="关闭预览"
              onClick={() => setImagePreview(null)}
            >
              ×
            </button>
          </div>
          <img className="lm-fs-side-preview-img" src={imagePreview.dataUrl} alt={imagePreview.name} />
          <div className="lm-fs-side-preview-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy}
              onClick={async () => {
                setError(null);
                const r = await window.lawmindDesktop?.openWithSystem({
                  root: imagePreview.root,
                  path: imagePreview.relPath,
                });
                if (r && !r.ok) {
                  setError(r.error ?? "无法用系统应用打开该文件。");
                }
              }}
            >
              用本机应用打开
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => void doShowInFolder(imagePreview.root, imagePreview.relPath)}
            >
              访达中显示
            </button>
          </div>
        </div>
      ) : null}

      {!portalHosts?.editor && officeBlock ? (
        <div className="lm-fs-side-preview lm-fs-side-preview--binary" data-testid="lm-fs-binary-preview-side">
          <div className="lm-fs-side-preview-head">
            <strong className="lm-fs-side-preview-title">{officeBlock.name}</strong>
            <button
              type="button"
              className="lm-error-dismiss"
              aria-label="关闭"
              onClick={() => setOfficeBlock(null)}
            >
              ×
            </button>
          </div>
          <p className="lm-meta">
            {officeBlock.mode === "binary"
              ? "二进制文件无法在侧栏文本编辑。请用本机应用打开。"
              : "Office/PDF 请用本机应用打开。"}
          </p>
          <div className="lm-fs-side-preview-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy}
              onClick={async () => {
                setError(null);
                const r = await window.lawmindDesktop?.openWithSystem({
                  root: officeBlock.root,
                  path: officeBlock.relPath,
                });
                if (r && !r.ok) {
                  setError(r.error ?? "无法用系统应用打开该文件。");
                }
              }}
            >
              用本机应用打开
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="lm-callout lm-callout-danger lm-error--explorer" role="alert">
          <p className="lm-callout-body">{error}</p>
          <button type="button" className="lm-error-dismiss" aria-label="关闭错误提示" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}
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
      imagePreview={imagePreview}
      setImagePreview={setImagePreview}
      officeBlock={officeBlock}
      setOfficeBlock={setOfficeBlock}
      setError={setError}
      closeTab={closeTab}
      updateActiveContent={updateActiveContent}
      saveActive={saveActive}
      saveActiveAs={saveActiveAs}
      doShowInFolder={doShowInFolder}
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

  if (portalHosts?.explorer) {
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
