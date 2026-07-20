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
import {
  isProtectedWorkspacePath,
  keyOf,
  getDirname,
  getFileIcon,
  QuickOpenModal,
} from "./file-workbench-fs";
import { matterIdFromWorkspaceCasesRelPath, isWorkspaceCaseSubdirRootRelPath } from "../lawmind-cases-path";
import { filterExplorerEntries } from "../lawmind-explorer-lawyer-view";
import { FileWorkbenchDialogs } from "./FileWorkbenchDialogs";
import { FileWorkbenchContextMenu } from "./FileWorkbenchContextMenu";

export type FileWorkbenchViewModel = {
  workspaceDir: string;
  projectDir: string | null;
  onPickProject?: () => void | Promise<void>;
  canUseFilesystemBridge: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
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

  // ── File tree render ─────────────────────────────────────────
  /** 在某一父目录下按名称排除顶级项（工作区根不重复展示 `cases/`） */
  type TreeOmit = { forParentDir: string; names: Set<string> };

  const renderTree = (root: RootKey, dirPath: string, level: number, omit?: TreeOmit): ReactNode => {
    const k = keyOf(root, dirPath);
    const raw = childrenByDir[k] ?? [];
    let entries = filterExplorerEntries(root, dirPath, raw);
    if (omit && dirPath === omit.forParentDir) {
      entries = entries.filter((e) => !omit.names.has(e.name));
    }
    const pad = 8 + level * 14;

    const nodes: ReactNode[] = [];

    // Inline input for new file/folder at this level
    if (inlineInput?.root === root && inlineInput.parentDir === dirPath && inlineInput.kind !== "file") {
      nodes.push(
        <div key="__new_folder__" className="lm-fs-inline-input" style={{ paddingLeft: pad + 16 }}>
          <input
            ref={inlineInputRef}
            type="text"
            placeholder={inlineInput.placeholder ?? "文件夹名…"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {void inlineInput.onDone(e.currentTarget.value);}
              if (e.key === "Escape") {setInlineInput(null);}
            }}
            onBlur={(e) => void inlineInput.onDone(e.currentTarget.value)}
          />
        </div>,
      );
    }

    for (const entry of entries) {
      const entryKey = keyOf(root, entry.path);
      const isOpen = Boolean(expanded[entryKey]);
      const isSelected = selected?.root === root && selected.path === entry.path;
      const isProtected = Boolean(isProtectedWorkspacePath(root, entry.path));

      // Inline rename input
      const isRenaming =
        inlineInput?.root === root &&
        getDirname(entry.path) === inlineInput.parentDir &&
        inlineInput.initialValue === entry.name &&
        inlineInput.kind === "file";

      if (isRenaming) {
        nodes.push(
          <div key={`__rename__${entry.path}`} className="lm-fs-inline-input" style={{ paddingLeft: pad + 16 }}>
            <input
              ref={inlineInputRef}
              type="text"
              defaultValue={inlineInput.initialValue}
              onKeyDown={(e) => {
                if (e.key === "Enter") {void inlineInput.onDone(e.currentTarget.value);}
                if (e.key === "Escape") {setInlineInput(null);}
              }}
              onBlur={(e) => void inlineInput.onDone(e.currentTarget.value)}
            />
          </div>,
        );
        continue;
      }

      if (entry.kind === "directory") {
        const caseMidForTree =
          root === "workspace" && isWorkspaceCaseSubdirRootRelPath(entry.path)
            ? matterIdFromWorkspaceCasesRelPath(entry.path)
            : null;
        const caseDisplayHint =
          caseMidForTree &&
          casesNodeActions?.matterLabelById?.[caseMidForTree]?.trim() &&
          casesNodeActions.matterLabelById[caseMidForTree] !== entry.name
            ? casesNodeActions.matterLabelById[caseMidForTree].trim()
            : null;
        const treeTitle =
          caseDisplayHint && !isProtected ? `${entry.name} — ${caseDisplayHint}` : isProtected ? "⚠️ 受保护目录" : entry.name;
        nodes.push(
          <div key={entry.path}>
            <button
              type="button"
              className={`lm-fs-node lm-fs-dir ${isSelected ? "active" : ""} ${isProtected ? "protected" : ""}`}
              style={{ paddingLeft: pad }}
              title={treeTitle}
              onClick={() => { setSelected({ root, path: entry.path, kind: "directory" }); void toggleDir(root, entry.path); }}
              onDoubleClick={(e) => {
                if (
                  root !== "workspace" ||
                  !casesNodeActions ||
                  !isWorkspaceCaseSubdirRootRelPath(entry.path)
                ) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                const mid = matterIdFromWorkspaceCasesRelPath(entry.path);
                if (mid) {
                  casesNodeActions.onOpenMatterCockpit(mid);
                }
              }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, root, path: entry.path, kind: "directory", isRoot: false }); }}
            >
              <span className={`lm-fs-arrow ${isOpen ? "open" : ""}`}>▸</span>
              <span className="lm-fs-icon">{getFileIcon(entry.name, "directory", isOpen)}</span>
              <span className="lm-fs-name">{entry.name}</span>
              {caseDisplayHint ? (
                <span className="lm-meta" style={{ marginLeft: 6, fontSize: "0.92em", opacity: 0.92 }}>
                  {caseDisplayHint}
                </span>
              ) : null}
              {isProtected && <span className="lm-fs-lock">🔒</span>}
            </button>
            {isOpen && renderTree(root, entry.path, level + 1, omit)}
          </div>,
        );
      } else {
        // Inline input for new file at this level
        const showNewFileInput =
          inlineInput?.root === root &&
          inlineInput.parentDir === dirPath &&
          inlineInput.kind === "file" &&
          !inlineInput.initialValue; // only for new files, not renames

        if (showNewFileInput) {
          nodes.push(
            <div key="__new_file__" className="lm-fs-inline-input" style={{ paddingLeft: pad + 16 }}>
              <input
                ref={inlineInputRef}
                type="text"
                placeholder="文件名（例如 notes.md）…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {void inlineInput.onDone(e.currentTarget.value);}
                  if (e.key === "Escape") {setInlineInput(null);}
                }}
                onBlur={(e) => void inlineInput.onDone(e.currentTarget.value)}
              />
            </div>,
          );
        }

        nodes.push(
          <button
            key={entry.path}
            type="button"
            className={`lm-fs-node lm-fs-file ${isSelected ? "active" : ""} ${isProtected ? "protected" : ""}`}
            style={{ paddingLeft: pad + 16 }}
            title={isProtected ? "⚠️ 受保护文件" : entry.name}
            onClick={() => { setSelected({ root, path: entry.path, kind: "file" }); void openFile(root, entry.path); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, root, path: entry.path, kind: "file", isRoot: false }); }}
          >
            <span className="lm-fs-icon">{getFileIcon(entry.name, "file")}</span>
            <span className="lm-fs-name">{entry.name}</span>
            {isProtected && <span className="lm-fs-lock">🔒</span>}
          </button>,
        );
      }
    }

    // Inline new-file input when list is empty or at the end
    if (inlineInput?.root === root && inlineInput.parentDir === dirPath && inlineInput.kind === "file" && !inlineInput.initialValue && entries.length === 0) {
      nodes.push(
        <div key="__new_file_empty__" className="lm-fs-inline-input" style={{ paddingLeft: pad + 16 }}>
          <input
            ref={inlineInputRef}
            type="text"
            placeholder="文件名（例如 notes.md）…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {void inlineInput.onDone(e.currentTarget.value);}
              if (e.key === "Escape") {setInlineInput(null);}
            }}
            onBlur={(e) => void inlineInput.onDone(e.currentTarget.value)}
          />
        </div>,
      );
    }

    return <div>{nodes}</div>;
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

  // ── Render ───────────────────────────────────────────────────
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
              {renderTree("project", "", 0)}
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
            renderTree("workspace", "cases", 0)
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
    <section className="lm-files-editor" onClick={(e) => e.stopPropagation()}>
        <div className="lm-file-tabs">
          {tabs.map((tab) => {
            const dirty = tab.content !== tab.savedContent;
            return (
              <button
                key={tab.id}
                type="button"
                className={`lm-file-tab ${activeTabId === tab.id ? "active" : ""}`}
                title={`${tab.root}:${tab.path}`}
                onClick={() => {
                  setOfficeBlock(null);
                  setImagePreview(null);
                  setActiveTabId(tab.id);
                }}
              >
                <span className="lm-fs-icon">{getFileIcon(tab.name, "file")}</span>
                <span>{tab.name}{dirty ? " ●" : ""}</span>
                <span
                  className="lm-file-tab-close"
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") {closeTab(tab.id);} }}
                >×</span>
              </button>
            );
          })}
        </div>

        {activeTab ? (
          <div className="lm-editor-pane">
            <div className="lm-editor-header">
              <div className="lm-editor-breadcrumb">
                <span className="lm-editor-root-badge">{activeTab.root}</span>
                <span className="lm-editor-path">{activeTab.path}</span>
              </div>
              <div className="lm-compose-actions">
                {activeDirty && <span className="lm-dot lm-dot-warn">未保存</span>}
                {onAddToChatContext && activeTab ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() => onAddToChatContext({ root: activeTab.root, relPath: activeTab.path, kind: "file" })}
                  >
                    加入对话引用
                  </button>
                ) : null}
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  disabled={busy || !activeTab}
                  title={!activeDirty ? "无未保存修改时不会写入" : "保存到当前文件（⌘S）"}
                  onClick={() => void saveActive()}
                >
                  保存
                </button>
                <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" disabled={busy || !activeTab} onClick={() => void saveActiveAs()}>另存为…</button>
              </div>
            </div>
            <textarea
              className="lm-editor-textarea"
              value={activeTab.content}
              onChange={(e) => updateActiveContent(e.target.value)}
              spellCheck={false}
            />
            <div className="lm-editor-statusbar">
              {activeTab.name} · {activeTab.content.split("\n").length} 行 · {activeTab.content.length} 字符
            </div>
          </div>
        ) : imagePreview ? (
          <div className="lm-editor-pane lm-image-preview-pane">
            <div className="lm-editor-header">
              <div className="lm-editor-breadcrumb">
                <span className="lm-editor-root-badge">{imagePreview.root}</span>
                <span className="lm-editor-path">{imagePreview.relPath || "(根)"}</span>
              </div>
              <div className="lm-editor-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  onClick={() => void doShowInFolder(imagePreview.root, imagePreview.relPath)}
                >
                  在访达中显示
                </button>
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
                {onAddToChatContext ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() =>
                      onAddToChatContext({
                        root: imagePreview.root,
                        relPath: imagePreview.relPath,
                        kind: "file",
                      })
                    }
                  >
                    在对话中引用
                  </button>
                ) : null}
              </div>
            </div>
            <div className="lm-image-preview-body">
              <img className="lm-image-preview-img" src={imagePreview.dataUrl} alt={imagePreview.name} />
              <p className="lm-meta lm-image-preview-caption">{imagePreview.name}</p>
            </div>
          </div>
        ) : officeBlock ? (
          <div className="lm-editor-pane lm-office-doc-pane">
            <div className="lm-editor-header">
              <div className="lm-editor-breadcrumb">
                <span className="lm-editor-root-badge">{officeBlock.root}</span>
                <span className="lm-editor-path">{officeBlock.relPath || "(根)"}</span>
              </div>
            </div>
            <div className="lm-office-doc-body">
              <p className="lm-office-doc-title">{officeBlock.name}</p>
              <p className="lm-office-doc-copy">
                {officeBlock.mode === "binary"
                  ? "该文件为二进制格式，无法在此纯文本编辑器中打开。可用本机应用查看，或在访达中打开。"
                  : "本页为纯文本材料编辑器，不支持 Word/Excel/PowerPoint/PDF 的版式与表格预览。请用本机已安装的 Office 或 WPS 等打开编辑。"}
              </p>
              <div className="lm-office-doc-actions">
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
                    if (r && ! r.ok) {
                      setError(r.error ?? "无法用系统应用打开该文件。");
                    }
                  }}
                >
                  用本机应用打开
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  onClick={() => void doShowInFolder(officeBlock.root, officeBlock.relPath)}
                >
                  在访达中显示
                </button>
                {onAddToChatContext ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() => onAddToChatContext({ root: officeBlock.root, relPath: officeBlock.relPath, kind: "file" })}
                  >
                    在对话中引用
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="lm-editor-empty">
            <div className="lm-messages-empty-icon">📂</div>
            <div className="lm-messages-empty-title">选择文件开始编辑</div>
            <div className="lm-messages-empty-hint">在左栏资源树中点击文件，或按 ⌘P 快速搜索。图片可预览；Word 文档请用系统应用打开。</div>
          </div>
        )}
      </section>
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
