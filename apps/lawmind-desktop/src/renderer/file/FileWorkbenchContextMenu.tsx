import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  type RootKey,
  type ContextMenu,
  type FsClip,
  type FileWorkbenchCasesNodeActions,
} from "./file-workbench-types";
import { getDirname, isProtectedWorkspacePath } from "./file-workbench-fs";
import { matterIdFromWorkspaceCasesRelPath, isWorkspaceCaseSubdirRootRelPath } from "../lawmind-cases-path";

export type FileWorkbenchContextMenuProps = {
  menuRef: RefObject<HTMLDivElement | null>;
  contextMenu: ContextMenu | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenu | null>>;
  casesNodeActions?: FileWorkbenchCasesNodeActions | null;
  fsClip: FsClip | null;
  canUseFilesystemBridge: boolean;
  busy: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  setAddToMatterManualDraft: Dispatch<SetStateAction<string>>;
  setAddToMatterLastError: Dispatch<SetStateAction<string | null>>;
  setAddToMatterPick: Dispatch<SetStateAction<{ relPath: string; kind: "file" | "directory" } | null>>;
  startCreate: (root: RootKey, parentDir: string, kind: "file" | "folder") => void;
  pasteInto: (root: RootKey, parentDir: string) => void | Promise<void>;
  copyPath: (root: RootKey, relPath: string) => void;
  cutPath: (root: RootKey, relPath: string) => void;
  startRename: (root: RootKey, relPath: string) => void;
  requestDelete: (root: RootKey, relPath: string, kind: "file" | "directory") => void;
  doShowInFolder: (root: RootKey, relPath: string) => void | Promise<void>;
  refreshDir: (root: RootKey, dirPath: string) => void | Promise<void>;
};

export function FileWorkbenchContextMenu({
  menuRef,
  contextMenu,
  setContextMenu,
  casesNodeActions,
  fsClip,
  canUseFilesystemBridge,
  busy,
  onAddToChatContext,
  setAddToMatterManualDraft,
  setAddToMatterLastError,
  setAddToMatterPick,
  startCreate,
  pasteInto,
  copyPath,
  cutPath,
  startRename,
  requestDelete,
  doShowInFolder,
  refreshDir,
}: FileWorkbenchContextMenuProps) {
  if (!contextMenu) {
    return null;
  }
  const { x, y, root, path: ctxPath, kind } = contextMenu;
  const parentDir = kind === "directory" ? ctxPath : getDirname(ctxPath);
  const canPasteHere = Boolean(fsClip && fsClip.root === root);
  /** 仅 `cases/<matterId>` 根目录显示案件级菜单；mail/附件等子路径不混入。 */
  const caseRootMid =
    root === "workspace" &&
    ctxPath &&
    casesNodeActions &&
    isWorkspaceCaseSubdirRootRelPath(ctxPath)
      ? matterIdFromWorkspaceCasesRelPath(ctxPath)
      : null;
  const cn = casesNodeActions;
  const isCasesRootContext =
    root === "workspace" && kind === "directory" && ctxPath === "cases" && cn;
  const canOfferAddToMatter =
    root === "workspace" &&
    Boolean(ctxPath) &&
    ctxPath !== "cases" &&
    !ctxPath.startsWith("cases/");
  const wsProtectedHint = ctxPath ? isProtectedWorkspacePath(root, ctxPath) : null;
  return (
    <div
      ref={menuRef}
      role="menu"
      className="lm-context-menu"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isCasesRootContext &&
      (cn.onNewMatterFolder || cn.onImportMatters || cn.onRefreshMatters) ? (
        <>
          {cn.onNewMatterFolder ? (
            <button
              type="button"
              role="menuitem"
              disabled={!cn.apiBase?.trim() && !canUseFilesystemBridge}
              onClick={() => {
                cn.onNewMatterFolder!();
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
      <button type="button" role="menuitem" onClick={() => startCreate(root, parentDir, "file")}>
        📄 新建文件
      </button>
      <button type="button" role="menuitem" onClick={() => startCreate(root, parentDir, "folder")}>
        📁 新建文件夹
      </button>
      {canPasteHere ? (
        <button type="button" role="menuitem" onClick={() => void pasteInto(root, parentDir)}>
          📋 粘贴
        </button>
      ) : null}
      {ctxPath ? (
        <>
          {onAddToChatContext ? (
            <button
              type="button"
              role="menuitem"
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
              role="menuitem"
              disabled={busy}
              title="将所选项移入某个案件的材料文件夹"
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
          {caseRootMid && cn ? (
            <>
              <div className="lm-context-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  cn.onOpenMatterCockpit(caseRootMid);
                  setContextMenu(null);
                }}
              >
                📋 打开案件工作台
              </button>
              {cn.onLinkMatterToChat ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    cn.onLinkMatterToChat!(caseRootMid);
                    setContextMenu(null);
                  }}
                >
                  在对话中关联本案
                </button>
              ) : null}
              {cn.onSetCaseSubdirRole ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void cn.onSetCaseSubdirRole!(caseRootMid, "matter");
                      setContextMenu(null);
                    }}
                  >
                    标记为正式案件
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void cn.onSetCaseSubdirRole!(caseRootMid, "folder");
                      setContextMenu(null);
                    }}
                  >
                    标记为资料夹
                  </button>
                </>
              ) : null}
              {cn.apiBase?.trim() ? (
                <>
                  <div className="lm-context-menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      cn.onRequestDeleteMatter(
                        caseRootMid,
                        cn.matterLabelById?.[caseRootMid] ?? caseRootMid,
                      );
                      setContextMenu(null);
                    }}
                  >
                    删除案件…
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          <div className="lm-context-menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={() => copyPath(root, ctxPath)}>
            📎 复制
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(wsProtectedHint)}
            title={wsProtectedHint ?? undefined}
            onClick={() => cutPath(root, ctxPath)}
          >
            ✂️ 剪切
          </button>
          <div className="lm-context-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(wsProtectedHint)}
            title={wsProtectedHint ?? undefined}
            onClick={() => startRename(root, ctxPath)}
          >
            ✏️ 重命名
          </button>
          {/* 案件根已有「删除案件…」，避免与文件系统删除重复 */}
          {!caseRootMid ? (
            <button
              type="button"
              role="menuitem"
              className={wsProtectedHint ? "danger" : ""}
              onClick={() => requestDelete(root, ctxPath, kind)}
            >
              🗑️ 删除{wsProtectedHint ? " ⚠️" : ""}
            </button>
          ) : null}
        </>
      ) : onAddToChatContext ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onAddToChatContext({ root, relPath: "", kind: "directory" });
            setContextMenu(null);
          }}
        >
          💬 在对话中引用{root === "workspace" ? "材料" : "本机文件夹"}根目录
        </button>
      ) : null}
      <div className="lm-context-menu-sep" role="separator" />
      <button type="button" role="menuitem" onClick={() => void doShowInFolder(root, ctxPath)}>
        📂 在访达中显示
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setContextMenu(null);
          void refreshDir(root, ctxPath && kind === "file" ? getDirname(ctxPath) : ctxPath);
        }}
      >
        🔄 刷新
      </button>
    </div>
  );
}
