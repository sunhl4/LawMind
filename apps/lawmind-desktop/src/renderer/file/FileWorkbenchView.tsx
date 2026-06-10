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
  basename,
  getDirname,
  getFileIcon,
  QuickOpenModal,
  parseCasesRelForWorkspaceMove,
} from "./file-workbench-fs";
import { matterIdFromWorkspaceCasesRelPath, isWorkspaceCaseSubdirRootRelPath } from "../lawmind-cases-path";
import { filterExplorerEntries } from "../lawmind-explorer-lawyer-view";
import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";

export type FileWorkbenchViewModel = {
  workspaceDir: string;
  projectDir: string | null;
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
  officeBlock: { root: RootKey; relPath: string; name: string } | null;
  setOfficeBlock: React.Dispatch<React.SetStateAction<{ root: RootKey; relPath: string; name: string } | null>>;
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
  moveCaseItemToWorkspaceRoot: (relPath: string, kind: "file" | "directory") => void;
  copyPath: (root: RootKey, relPath: string) => void;
  cutPath: (root: RootKey, relPath: string) => void;
  refreshDir: (root: RootKey, dirPath: string) => void | Promise<void>;
};

export function FileWorkbenchView(vm: FileWorkbenchViewModel) {
  const {
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
    moveCaseItemToWorkspaceRoot,
    copyPath,
    cutPath,
    refreshDir,
  } = vm;

  // ── File tree render ─────────────────────────────────────────
  /** 在某一父目录下按名称排除顶级项（用于「工作目录」树根不重复展示 `cases/`） */
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
            placeholder="文件夹名…"
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
            title={isProtected ? "⚠️ 受保护文件" : entry.path}
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

  // ── Confirm dialogs ──────────────────────────────────────────
  const renderAddToMatterPicker = () => {
    if (!addToMatterPick) {
      return null;
    }
    const leaf = basename(addToMatterPick.relPath);
    const manualTrim = addToMatterManualDraft.trim();
    const manualOk = isValidMatterId(manualTrim);
    const openList = mattersPickList !== null && mattersPickList !== undefined && mattersPickList.length > 0;
    return (
      <div
        className="lm-wizard-backdrop"
        style={{ zIndex: 21_000 }}
        role="dialog"
        aria-modal="true"
        aria-label="加入案件"
        onClick={() => {
          if (!busy) {
            setAddToMatterPick(null);
          }
        }}
      >
        <div className="lm-wizard lm-wizard--detail" onClick={(e) => e.stopPropagation()}>
          <h2>加入案件</h2>
          <p className="lm-wizard-lead">
            将「{leaf}」移入案件卷宗文件夹（<code className="lm-meta">cases/…/</code>）。重名时自动追加序号。
          </p>
          {openList ? (
            <>
              <p className="lm-wizard-lead" style={{ marginBottom: 10, fontSize: 13, opacity: 0.92 }}>从列表选择</p>
              <div className="lm-matter-pick-list" style={{ maxHeight: "min(40vh, 240px)", overflow: "auto" }}>
                {mattersPickList.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: 8, textAlign: "left" }}
                    disabled={busy}
                    onClick={() => void moveWorkspaceItemIntoMatter(m.id, addToMatterPick.relPath, addToMatterPick.kind)}
                  >
                    <span style={{ fontWeight: 600, marginRight: 8 }}>{m.label}</span>
                    <span className="lm-meta">{m.id}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="lm-field lm-field--spaced" style={{ marginTop: openList ? 18 : 0 }}>
            <label className="lm-field-label" htmlFor="lawmind-add-matter-manual-id">
              {openList ? "或手动输入案件编号" : "输入案件编号"}
            </label>
            <input
              id="lawmind-add-matter-manual-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="字母或数字开头，如 Acme-2024-01"
              value={addToMatterManualDraft}
              onChange={(e) => {
                setAddToMatterManualDraft(e.target.value);
                setAddToMatterLastError(null);
              }}
            />
            {manualTrim && !manualOk ? (
              <p style={{ fontSize: 12, color: "var(--error)", marginTop: 8, lineHeight: 1.5 }}>
                编号须 2–128 位：字母或数字开头，可含英文句点、下划线、连字符。
              </p>
            ) : null}
          </div>
          {addToMatterLastError ? (
            <div className="lm-callout lm-callout-danger" role="alert" style={{ marginTop: 12 }}>
              <p className="lm-callout-body">{addToMatterLastError}</p>
            </div>
          ) : null}
          <div className="lm-wizard-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary"
              disabled={busy}
              onClick={() => setAddToMatterPick(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="lm-btn"
              disabled={busy || !manualOk}
              onClick={() => void moveWorkspaceItemIntoMatter(manualTrim, addToMatterPick.relPath, addToMatterPick.kind)}
            >
              用此编号移入
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderConfirmDialog = () => {
    if (!confirmDialog) {return null;}
    if (confirmDialog.kind === "simple") {
      return (
        <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
          <div className="lm-wizard lm-wizard--confirm" onClick={(e) => e.stopPropagation()}>
            <p className="lm-wizard-lead">{confirmDialog.message}</p>
            <div className="lm-wizard-actions">
              <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
              <button type="button" className="lm-btn" onClick={confirmDialog.onConfirm}>确认</button>
            </div>
          </div>
        </div>
      );
    }
    const requiredName = confirmDialog.body.match(/"([^"]+)" 确认删除：/)?.[1] ?? "";
    const canConfirm = !requiredName || dangerInput.trim() === requiredName;
    return (
      <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
        <div className="lm-wizard lm-wizard--danger" onClick={(e) => e.stopPropagation()}>
          <h2 className="lm-wizard-title-danger">{confirmDialog.title}</h2>
          <p className="lm-wizard-body-pre">{confirmDialog.body}</p>
          {requiredName && (
            <div className="lm-field lm-field--spaced lm-field-match-confirm">
              <input
                type="text"
                value={dangerInput}
                placeholder={`输入"${requiredName}"确认`}
                aria-invalid={!canConfirm}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setDangerInput(e.target.value)}
              />
            </div>
          )}
          <div className="lm-wizard-actions">
            <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
            <button type="button" className="lm-btn lm-btn-destructive" disabled={!canConfirm} onClick={confirmDialog.onConfirm}>
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Context menu ─────────────────────────────────────────────
  const renderContextMenu = () => {
    if (!contextMenu) {return null;}
    const { x, y, root, path: ctxPath, kind } = contextMenu;
    const parentDir = kind === "directory" ? ctxPath : getDirname(ctxPath);
    const canPasteHere = Boolean(fsClip && fsClip.root === root);
    const caseMid =
      root === "workspace" && ctxPath && casesNodeActions
        ? matterIdFromWorkspaceCasesRelPath(ctxPath)
        : null;
    const cn = casesNodeActions;
    const isCasesRootContext =
      root === "workspace" && kind === "directory" && ctxPath === "cases" && cn;
    const caseMoveParsed =
      root === "workspace" && ctxPath && ctxPath.startsWith("cases/") && ctxPath !== "cases"
        ? parseCasesRelForWorkspaceMove(ctxPath)
        : null;
    const canOfferAddToMatter =
      root === "workspace" &&
      Boolean(ctxPath) &&
      ctxPath !== "cases" &&
      !ctxPath.startsWith("cases/");
    const wsProtectedHint = ctxPath ? isProtectedWorkspacePath(root, ctxPath) : null;
    return (
      <div ref={menuRef} className="lm-context-menu" style={{ top: y, left: x }} onContextMenu={(e) => e.preventDefault()}>
        {isCasesRootContext &&
        (cn.onNewMatter || cn.onImportMatters || cn.onRefreshMatters) ? (
          <>
            {cn.onNewMatter ? (
              <button
                type="button"
                role="menuitem"
                disabled={!cn.apiBase?.trim()}
                onClick={() => {
                  cn.onNewMatter!();
                  setContextMenu(null);
                }}
              >
                新建案件…
              </button>
            ) : null}
            {cn.canImportMatters && cn.onImportMatters ? (
              <button
                type="button"
                role="menuitem"
                disabled={(cn.importMattersBusy ?? false) || !cn.apiBase?.trim()}
                title="按文件或文件夹导入（每项一个案件；展示名取自名称）"
                onClick={() => {
                  cn.onImportMatters!();
                  setContextMenu(null);
                }}
              >
                {cn.importMattersBusy ? "导入中…" : "导入案件…"}
              </button>
            ) : null}
            {cn.onRefreshMatters ? (
              <button
                type="button"
                role="menuitem"
                disabled={!cn.apiBase?.trim()}
                onClick={() => {
                  cn.onRefreshMatters!();
                  setContextMenu(null);
                }}
              >
                刷新案件列表
              </button>
            ) : null}
            <div className="lm-context-menu-sep" role="separator" />
          </>
        ) : null}
        <button type="button" onClick={() => startCreate(root, parentDir, "file")}>📄 新建文件</button>
        <button type="button" onClick={() => startCreate(root, parentDir, "folder")}>📁 新建文件夹</button>
        {canPasteHere ? (
          <button type="button" onClick={() => void pasteInto(root, parentDir)}>📋 粘贴</button>
        ) : null}
        {ctxPath ? (
          <>
            {onAddToChatContext ? (
              <button
                type="button"
                onClick={() => {
                  onAddToChatContext({ root, relPath: ctxPath, kind });
                  setContextMenu(null);
                }}
              >
                💬 在对话中引用{kind === "directory" ? "（整目录）" : ""}
              </button>
            ) : null}
            {canOfferAddToMatter ? (
              <button
                type="button"
                disabled={busy}
                title="将所选项移入 cases/案件编号/（可列表选或手动输入编号）"
                onClick={() => {
                  setAddToMatterManualDraft("");
                  setAddToMatterLastError(null);
                  setAddToMatterPick({ relPath: ctxPath, kind });
                  setContextMenu(null);
                }}
              >
                📥 加入案件…
              </button>
            ) : null}
            {caseMid && cn ? (
              <>
                <div className="lm-context-menu-sep" />
                <button
                  type="button"
                  onClick={() => {
                    cn.onOpenMatterCockpit(caseMid);
                    setContextMenu(null);
                  }}
                >
                  📋 打开案件工作台
                </button>
                {cn.onLinkMatterToChat ? (
                  <button
                    type="button"
                    onClick={() => {
                      cn.onLinkMatterToChat!(caseMid);
                      setContextMenu(null);
                    }}
                  >
                    在对话中关联本案
                  </button>
                ) : null}
                {cn.workspaceDir?.trim() &&
                typeof window !== "undefined" &&
                window.lawmindDesktop?.showItemInFolder ? (
                  <button
                    type="button"
                    onClick={() => {
                      const w = cn.workspaceDir!.replace(/[/\\]+$/, "");
                      void window.lawmindDesktop?.showItemInFolder(`${w}/cases/${caseMid}`);
                      setContextMenu(null);
                    }}
                  >
                    打开案件文件夹
                  </button>
                ) : null}
                {cn.apiBase?.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      cn.onRequestRenameDisplayName(caseMid, cn.matterLabelById?.[caseMid] ?? caseMid);
                      setContextMenu(null);
                    }}
                  >
                    重命名展示名称…
                  </button>
                ) : null}
                {cn.onSetCaseSubdirRole ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void cn.onSetCaseSubdirRole!(caseMid, "matter");
                        setContextMenu(null);
                      }}
                    >
                      标记为正式案件
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void cn.onSetCaseSubdirRole!(caseMid, "folder");
                        setContextMenu(null);
                      }}
                    >
                      标记为资料夹
                    </button>
                  </>
                ) : null}
                {cn.apiBase?.trim() ? (
                  <>
                    <div className="lm-context-menu-sep" />
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        cn.onRequestDeleteMatter(caseMid, cn.matterLabelById?.[caseMid] ?? caseMid);
                        setContextMenu(null);
                      }}
                    >
                      删除案件…
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
            {caseMoveParsed ? (
              <>
                <div className="lm-context-menu-sep" role="separator" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => moveCaseItemToWorkspaceRoot(ctxPath, kind)}
                >
                  📤 移出案件目录…
                </button>
              </>
            ) : null}
            <div className="lm-context-menu-sep" />
            <button type="button" onClick={() => copyPath(root, ctxPath)}>📎 复制</button>
            <button
              type="button"
              disabled={Boolean(wsProtectedHint)}
              title={wsProtectedHint ?? undefined}
              onClick={() => cutPath(root, ctxPath)}
            >
              ✂️ 剪切
            </button>
            <div className="lm-context-menu-sep" />
            <button
              type="button"
              disabled={Boolean(wsProtectedHint)}
              title={wsProtectedHint ?? undefined}
              onClick={() => startRename(root, ctxPath)}
            >
              ✏️ 重命名
            </button>
            <button
              type="button"
              className={wsProtectedHint ? "danger" : ""}
              onClick={() => requestDelete(root, ctxPath, kind)}
            >
              🗑️ 删除{wsProtectedHint ? " ⚠️" : ""}
            </button>
          </>
        ) : onAddToChatContext ? (
          <button
            type="button"
            onClick={() => {
              onAddToChatContext({ root, relPath: "", kind: "directory" });
              setContextMenu(null);
            }}
          >
            💬 在对话中引用{root === "workspace" ? "材料" : "项目"}根目录
          </button>
        ) : null}
        <div className="lm-context-menu-sep" />
        <button type="button" onClick={() => void doShowInFolder(root, ctxPath)}>📂 在访达中显示</button>
        <button type="button" onClick={() => { setContextMenu(null); void refreshDir(root, ctxPath && kind === "file" ? getDirname(ctxPath) : ctxPath); }}>🔄 刷新</button>
      </div>
    );
  };

  const renderExplorerSectionHeader = (opts: {
    label: string;
    hint: string;
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
        <span className="lm-fs-dual-hint">{opts.hint}</span>
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

      <div className="lm-fs-section lm-fs-section-dual">
        {renderExplorerSectionHeader({
          label: "工作目录",
          hint: "笔记、模板、通用材料等日常工作",
          root: "workspace",
          menuPath: "",
          sectionOpen: workSectionOpen,
          setSectionOpen: setWorkSectionOpen,
          onAddFile: () => startCreate("workspace", "", "file"),
          addTitle: "在工作区根目录新建文件",
        })}
        {workSectionOpen
          ? renderTree("workspace", "", 0, { forParentDir: "", names: new Set(["cases"]) })
          : null}
      </div>

      <div className="lm-fs-section lm-fs-section-dual">
        {renderExplorerSectionHeader({
          label: "案件目录",
          hint: "cases · 个案卷宗（右键此处可新建 / 导入 / 刷新案件）",
          root: "workspace",
          menuPath: "cases",
          sectionOpen: casesSectionOpen,
          setSectionOpen: setCasesSectionOpen,
          onAddFile: () => startCreate("workspace", "cases", "file"),
          addTitle: "在 cases 下新建文件",
        })}
        {casesSectionOpen ? (
          casesDirProbe === "missing" ? (
            <p className="lm-fs-dual-empty">
              尚未创建 <code className="lm-meta">cases</code> 目录。使用上方「新建」或「导入」案件后将自动出现；也可在访达中于工作区根下手动创建{" "}
              <code className="lm-meta">cases</code> 文件夹。
            </p>
          ) : (
            renderTree("workspace", "cases", 0)
          )
        ) : null}
      </div>

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
                <span className="lm-send-hint">⌘S 保存 · ⇧⌘S 另存为</span>
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
                本页为纯文本材料编辑器，不支持 Word/Excel/PowerPoint/PDF 的版式与表格预览。请用本机已安装的 Office 或 WPS 等打开编辑。
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
            <div className="lm-messages-empty-hint">在左栏资源树中点击文件，或按 ⌘P 快速搜索。Word 文档会提示用系统应用打开。</div>
          </div>
        )}
      </section>
  );

  const floatingLayer = (
    <>
      {renderContextMenu()}
      {renderConfirmDialog()}
      {renderAddToMatterPicker()}
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
