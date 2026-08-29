import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import {
  type RootKey,
  type FsEntry,
  type InlineInput,
  type ContextMenu,
  type FileWorkbenchCasesNodeActions,
} from "./file-workbench-types";
import { isProtectedWorkspacePath, keyOf, getDirname, getFileIcon } from "./file-workbench-fs";
import { matterIdFromWorkspaceCasesRelPath, isWorkspaceCaseSubdirRootRelPath } from "../lawmind-cases-path";
import { filterExplorerEntries } from "../lawmind-explorer-lawyer-view";
import { encodeLawmindFsDrag, LAWMID_FS_DRAG_MIME } from "../lawmind-file-drag";

/** 在某一父目录下按名称排除顶级项（工作区根不重复展示 `cases/`） */
export type FileWorkbenchTreeOmit = { forParentDir: string; names: Set<string> };

export type FileWorkbenchTreeProps = {
  root: RootKey;
  dirPath: string;
  level?: number;
  omit?: FileWorkbenchTreeOmit;
  childrenByDir: Record<string, FsEntry[]>;
  expanded: Record<string, boolean>;
  selected: { root: RootKey; path: string; kind: "file" | "directory" } | null;
  setSelected: Dispatch<SetStateAction<{ root: RootKey; path: string; kind: "file" | "directory" } | null>>;
  inlineInput: InlineInput | null;
  setInlineInput: Dispatch<SetStateAction<InlineInput | null>>;
  inlineInputRef: RefObject<HTMLInputElement | null>;
  casesNodeActions?: FileWorkbenchCasesNodeActions | null;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  toggleDir: (root: RootKey, dirPath: string) => void | Promise<void>;
  openFile: (root: RootKey, path: string) => void | Promise<void>;
  setContextMenu: Dispatch<SetStateAction<ContextMenu | null>>;
};

export function FileWorkbenchTree({
  root,
  dirPath,
  level = 0,
  omit,
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
}: FileWorkbenchTreeProps) {
  const k = keyOf(root, dirPath);
  const raw = childrenByDir[k] ?? [];
  let entries = filterExplorerEntries(root, dirPath, raw);
  if (omit && dirPath === omit.forParentDir) {
    entries = entries.filter((e) => !omit.names.has(e.name));
  }
  const pad = 8 + level * 14;

  const nodes: ReactNode[] = [];

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
            draggable={Boolean(onAddToChatContext) && !isProtected}
            onDragStart={(e) => {
              if (!onAddToChatContext || isProtected) {
                e.preventDefault();
                return;
              }
              const payload = encodeLawmindFsDrag({
                root,
                relPath: entry.path,
                kind: "directory",
              });
              e.dataTransfer.setData(LAWMID_FS_DRAG_MIME, payload);
              e.dataTransfer.setData("text/plain", entry.path || entry.name);
              e.dataTransfer.effectAllowed = "copy";
            }}
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
          {isOpen ? (
            <FileWorkbenchTree
              root={root}
              dirPath={entry.path}
              level={level + 1}
              omit={omit}
              childrenByDir={childrenByDir}
              expanded={expanded}
              selected={selected}
              setSelected={setSelected}
              inlineInput={inlineInput}
              setInlineInput={setInlineInput}
              inlineInputRef={inlineInputRef}
              casesNodeActions={casesNodeActions}
              onAddToChatContext={onAddToChatContext}
              toggleDir={toggleDir}
              openFile={openFile}
              setContextMenu={setContextMenu}
            />
          ) : null}
        </div>,
      );
    } else {
      const showNewFileInput =
        inlineInput?.root === root &&
        inlineInput.parentDir === dirPath &&
        inlineInput.kind === "file" &&
        !inlineInput.initialValue;

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
          draggable={Boolean(onAddToChatContext) && !isProtected}
          onDragStart={(e) => {
            if (!onAddToChatContext || isProtected) {
              e.preventDefault();
              return;
            }
            const payload = encodeLawmindFsDrag({
              root,
              relPath: entry.path,
              kind: "file",
            });
            e.dataTransfer.setData(LAWMID_FS_DRAG_MIME, payload);
            e.dataTransfer.setData("text/plain", entry.path || entry.name);
            e.dataTransfer.effectAllowed = "copy";
          }}
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
}
