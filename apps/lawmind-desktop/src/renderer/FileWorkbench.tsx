import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { matterIdFromWorkspaceCasesRelPath, isWorkspaceCaseSubdirRootRelPath } from "./lawmind-cases-path";
import {
  filterExplorerEntries,
  shouldShowExplorerDirectory,
  shouldShowExplorerFile,
} from "./lawmind-explorer-lawyer-view";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "./lawmind-panel-layout";
import { usePaneResizePx } from "./use-pane-resize";

type RootKey = "workspace" | "project";

type FsEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mtimeMs: number;
};

type OpenFileTab = {
  id: string;
  root: RootKey;
  path: string;
  name: string;
  content: string;
  savedContent: string;
  mtimeMs: number;
};

type IndexedFile = { root: RootKey; path: string; name: string };

type ContextMenu = {
  x: number;
  y: number;
  root: RootKey;
  path: string;
  kind: "file" | "directory";
  isRoot: boolean;
};

type ConfirmDialog =
  | { kind: "simple"; message: string; onConfirm: () => void }
  | { kind: "danger"; title: string; body: string; confirmLabel: string; onConfirm: () => void };

type InlineInput = {
  root: RootKey;
  parentDir: string;
  kind: "file" | "folder";
  initialValue: string;
  onDone: (name: string) => Promise<void>;
};

type FsClip = {
  op: "copy" | "cut";
  root: RootKey;
  relPaths: string[];
};

type FilePortalHosts = {
  explorer: HTMLElement | null;
  /** When set, drag handle lives between file tree and the next column (legacy three-column rail). */
  split?: HTMLElement | null;
  /** 主区为案件工作台时可缺省，仅保留侧栏材料树。 */
  editor?: HTMLElement | null;
  /** Rail = fixed-width tree column; embedded = stretch inside sidebar. Default: rail if split is set, else embedded. */
  explorerLayout?: "rail" | "embedded";
};

export type FileWorkbenchCasesNodeActions = {
  apiBase: string;
  workspaceDir?: string | null;
  matterLabelById?: Record<string, string>;
  onOpenMatterCockpit: (matterId: string) => void;
  onLinkMatterToChat?: (matterId: string) => void;
  onRequestRenameDisplayName: (matterId: string, initialTitle: string) => void;
  onRequestDeleteMatter: (matterId: string, label: string) => void;
  onSetCaseSubdirRole?: (matterId: string, role: "matter" | "folder") => void | Promise<void>;
  /** 在「案件目录」或磁盘路径为 `cases` 的目录上右键：新建/导入/刷新（与顶部工具条案件操作一致） */
  onNewMatter?: () => void;
  onImportMatters?: () => void;
  onRefreshMatters?: () => void;
  importMattersBusy?: boolean;
  /** 桌面环境是否支持文件选择导入 */
  canImportMatters?: boolean;
};

type Props = {
  workspaceDir: string;
  projectDir: string | null;
  canUseFilesystemBridge: boolean;
  /** 将路径加入对话引用（会切换到对话；发送时把路径说明一并给模型） */
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  /** When set, 资源管理器 / 分割条 / 编辑器分别挂到这些节点（用于侧栏资源区 + 主区对话等布局） */
  portalHosts?: FilePortalHosts | null;
  /** 工作区资源区顶部工具条（如未关联、案件工作台等） */
  workspaceExplorerToolbar?: ReactNode;
  /** `cases/<id>/` 下文件/目录的右键扩展（案件工作台、角色等） */
  casesNodeActions?: FileWorkbenchCasesNodeActions | null;
  /** 右键「加入案件」时可选目标（通常取自 records 案件列表，不含「未关联」） */
  mattersPickList?: Array<{ id: string; label: string }> | null;
  /** 与案件列表联动（如删除/新建案件后递增）：刷新工作区与 cases 树缓存，避免出现陈旧节点 */
  workspaceTreeRefreshKey?: number;
};

// Core workspace paths that require lawyer confirmation before delete/rename.
const PROTECTED_WORKSPACE: Record<string, string> = {
  "assistants.json": "助手配置文件 — 删除后所有助手定义将永久丢失",
  sessions: "会话记录目录 — 删除后所有对话历史将永久丢失",
  cases: "案件数据目录 — 删除后所有案件资料将永久丢失",
  memory: "记忆数据库目录 — 删除后助手长期记忆将清空",
  delegations: "协作委派记录目录 — 删除后协作历史将丢失",
};

function isProtectedWorkspacePath(root: RootKey, relPath: string): string | null {
  if (root !== "workspace") {
    return null;
  }
  const norm = relPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!norm) {
    return null;
  }
  const parts = norm.split("/").filter(Boolean);
  const top = parts[0];
  if (!top) {
    return null;
  }
  // 仅保护根级的 `cases` 容器目录；`cases/<卷宗>/…` 内材料按普通路径
  if (top === "cases") {
    return norm === "cases" ? PROTECTED_WORKSPACE.cases : null;
  }
  if (top === "assistants.json") {
    return norm === "assistants.json" ? PROTECTED_WORKSPACE["assistants.json"] : null;
  }
  return PROTECTED_WORKSPACE[top] ?? null;
}

/** Word / Office / PDF：本工作台为纯文本编辑器，不内嵌富文本预览 */
function isOfficeLikePath(relPath: string): boolean {
  const low = relPath.toLowerCase();
  return [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"].some((s) => low.endsWith(s));
}

function keyOf(root: RootKey, dirPath: string): string {
  return `${root}:${dirPath}`;
}

function basename(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? relPath;
}

function getDirname(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function joinRelPath(a: string, b: string): string {
  const l = a.replace(/^\/+|\/+$/g, "");
  const r = b.replace(/^\/+|\/+$/g, "");
  if (!l) {return r;}
  if (!r) {return l;}
  return `${l}/${r}`;
}

function splitStemExt(name: string, kind: "file" | "directory"): { stem: string; ext: string } {
  if (kind === "directory") {
    return { stem: name, ext: "" };
  }
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/**
 * `cases/...` → 第一层路径段 + 相对工作区根的目标相对路径（不含 `cases/<seg>/` 前缀）。
 * 例如 `cases/mid/a/b` → `{ firstSeg: "mid", workspaceDestRel: "a/b" }`；
 * `cases/mid` → `{ firstSeg: "mid", workspaceDestRel: "" }`。
 */
function parseCasesRelForWorkspaceMove(relPath: string): { firstSeg: string; workspaceDestRel: string } | null {
  const norm = relPath.replace(/^\/+/, "");
  if (!norm.startsWith("cases/")) {
    return null;
  }
  const rest = norm.slice("cases/".length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const firstSeg = parts[0];
  const inner = parts.slice(1);
  return { firstSeg, workspaceDestRel: inner.join("/") };
}

/** 在 `parentDir` 下为 `leaf` 分配不冲突的相对路径（含父级 mkdir）。 */
async function allocateNonCollidingChildPath(
  root: RootKey,
  parentDir: string,
  leaf: string,
  kind: "file" | "directory",
): Promise<string> {
  if (parentDir) {
    const mk = await window.lawmindDesktop?.fsMkdir({ root, path: parentDir });
    if (mk && !mk.ok) {
      throw new Error(mk.error ?? "无法创建目标目录");
    }
  }
  const res = await window.lawmindDesktop?.fsList({ root, path: parentDir });
  if (res && !res.ok) {
    throw new Error(res.error ?? "无法列出目录");
  }
  const existing = new Set((res?.entries ?? []).map((e: FsEntry) => e.name));
  const { stem, ext } = splitStemExt(leaf, kind);
  let candidate = leaf;
  let n = 0;
  while (existing.has(candidate)) {
    n++;
    candidate = ext ? `${stem} (${n})${ext}` : `${stem} (${n})`;
  }
  return joinRelPath(parentDir, candidate);
}

async function allocateNonCollidingRelPath(root: RootKey, desiredRelPath: string, kind: "file" | "directory"): Promise<string> {
  const parts = desiredRelPath.split("/").filter(Boolean);
  const parent = parts.length <= 1 ? "" : parts.slice(0, -1).join("/");
  const leaf = parts.length === 0 ? desiredRelPath : (parts[parts.length - 1] ?? desiredRelPath);
  return allocateNonCollidingChildPath(root, parent, leaf, kind);
}

function resolveRelForAbs(
  workspaceDir: string,
  projectDir: string | null,
  absPath: string,
): { root: RootKey; rel: string } | null {
  const a = absPath.replace(/\\/g, "/");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  const p = projectDir?.replace(/\\/g, "/").replace(/\/$/, "") ?? "";
  if (w && (a === w || a.startsWith(`${w}/`))) {
    return { root: "workspace", rel: a === w ? "" : a.slice(w.length + 1) };
  }
  if (p && (a === p || a.startsWith(`${p}/`))) {
    return { root: "project", rel: a === p ? "" : a.slice(p.length + 1) };
  }
  return null;
}

function getFileIcon(name: string, kind: "file" | "directory", isOpen = false): string {
  if (kind === "directory") {return isOpen ? "📂" : "📁";}
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "📝", txt: "📄", json: "📋", ts: "📘", tsx: "📘",
    js: "📙", jsx: "📙", css: "🎨", html: "🌐", pdf: "📕",
    docx: "📝", doc: "📝", xlsx: "📊", png: "🖼", jpg: "🖼",
    svg: "🖼", sh: "⚙️", yaml: "⚙️", yml: "⚙️",
  };
  return map[ext] ?? "📄";
}

// Fuzzy-ish scorer: exact match > name match > path match
function scoreMatch(file: IndexedFile, query: string): number {
  const q = query.toLowerCase();
  const name = file.name.toLowerCase();
  const p = file.path.toLowerCase();
  if (name === q) {return 100;}
  if (name.startsWith(q)) {return 80;}
  if (name.includes(q)) {return 60;}
  if (p.includes(q)) {return 30;}
  return 0;
}

// ── Quick Open Modal (Cursor-style) ──────────────────────────────────────────
// Completely standalone floating modal. No focus-management tricks needed:
// the input and list items are in the SAME React subtree; clicking a list item
// is a plain onClick that fires before any blur-induced unmount.
function QuickOpenModal({
  files,
  onOpen,
  onClose,
}: {
  files: IndexedFile[];
  onOpen: (root: RootKey, path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) {
      return files.slice(0, 14);
    }
    return files
      .map((f) => ({ f, score: scoreMatch(f, query) }))
      .filter(({ score }) => score > 0)
      .toSorted((a, b) => b.score - a.score)
      .map(({ f }) => f)
      .slice(0, 14);
  }, [files, query]);

  // Keep cursor in bounds when results change
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)));
  }, [results]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const confirm = (idx: number) => {
    const file = results[idx];
    if (file) {
      onOpen(file.root, file.path);
      onClose();
    }
  };

  return (
    <div
      className="lm-wizard-backdrop lm-wizard-backdrop--quickopen"
      onMouseDown={(e) => {
        // Close only when clicking the backdrop itself (not the modal)
        if (e.target === e.currentTarget) {onClose();}
      }}
    >
      <div className="lm-quickopen-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lm-quickopen-inputrow">
          <span className="lm-quickopen-magnifier">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="lm-quickopen-input"
            placeholder="输入文件名快速打开…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); confirm(cursor); }
            }}
          />
          <kbd className="lm-quickopen-esc" onClick={onClose}>Esc</kbd>
        </div>

        {results.length > 0 ? (
          <div ref={listRef} className="lm-quickopen-list">
            {results.map((f, i) => (
              <div
                key={`${f.root}:${f.path}`}
                className={`lm-quickopen-item ${i === cursor ? "active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                // Plain onClick works here: input and list are in the same modal,
                // so no blur/unmount race condition exists.
                onClick={() => confirm(i)}
              >
                <span className="lm-quickopen-item-icon">{getFileIcon(f.name, "file")}</span>
                <div className="lm-quickopen-item-text">
                  <span className="lm-quickopen-item-name">{f.name}</span>
                  <span className="lm-quickopen-item-path">{f.path}</span>
                </div>
                <span className="lm-quickopen-item-root">{f.root}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="lm-quickopen-empty">
            {files.length === 0 ? "索引中，请稍候…" : "未找到匹配文件"}
          </div>
        )}

        <div className="lm-quickopen-footer">
          <span>↑↓ 导航</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}

// ── Main FileWorkbench ────────────────────────────────────────────────────────
export function FileWorkbench(props: Props) {
  const {
    workspaceDir,
    projectDir,
    canUseFilesystemBridge,
    onAddToChatContext,
    portalHosts,
    workspaceExplorerToolbar,
    casesNodeActions,
    mattersPickList,
    workspaceTreeRefreshKey,
  } = props;

  const [childrenByDir, setChildrenByDir] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ root: RootKey; path: string; kind: "file" | "directory" } | null>(null);
  const [tabs, setTabs] = useState<OpenFileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);
  const [dangerInput, setDangerInput] = useState("");
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState<IndexedFile[]>([]);
  const [fsClip, setFsClip] = useState<FsClip | null>(null);
  const [officeBlock, setOfficeBlock] = useState<{ root: RootKey; relPath: string; name: string } | null>(null);
  /** 右键「加入案件」后选择目标案件 */
  const [addToMatterPick, setAddToMatterPick] = useState<{ relPath: string; kind: "file" | "directory" } | null>(null);
  /** 加入案件弹窗内手动输入的案件编号 */
  const [addToMatterManualDraft, setAddToMatterManualDraft] = useState("");
  /** 加入案件失败：显示在弹窗内（遮罩下侧栏错误条不易看见） */
  const [addToMatterLastError, setAddToMatterLastError] = useState<string | null>(null);
  /** 是否存在 `cases/`（用于案件目录区块提示） */
  const [casesDirProbe, setCasesDirProbe] = useState<"unknown" | "ok" | "missing">("unknown");
  const [workSectionOpen, setWorkSectionOpen] = useState(true);
  const [casesSectionOpen, setCasesSectionOpen] = useState(true);

  const { width: filesExplorerWidth, onResizePointerDown: onFilesExplorerResize } = usePaneResizePx({
    storageKey: "lawmind.ui.filesExplorerWidth",
    defaultWidth: 300,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
  });
  const explorerUsesRailLayout = (() => {
    const layout = portalHosts?.explorerLayout;
    if (layout === "rail") {return true;}
    if (layout === "embedded") {return false;}
    return Boolean(portalHosts?.split);
  })();

  const menuRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  /** 防止「加入案件」连点触发两次 rename */
  const moveIntoMatterInFlightRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeDirty = activeTab ? activeTab.content !== activeTab.savedContent : false;

  // ── Close context menu on outside click ─────────────────────
  useEffect(() => {
    if (!contextMenu) {return;}
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [contextMenu]);

  // ── Auto-focus inline input ──────────────────────────────────
  useEffect(() => {
    if (inlineInput) {setTimeout(() => inlineInputRef.current?.focus(), 50);}
  }, [inlineInput]);

  // ── Directory loading ────────────────────────────────────────
  const loadDir = useCallback(async (root: RootKey, dirPath: string) => {
    const res = await window.lawmindDesktop?.fsList({ root, path: dirPath });
    if (!res?.ok || !res.entries) {throw new Error(res?.error ?? "目录读取失败");}
    setChildrenByDir((prev) => ({ ...prev, [keyOf(root, dirPath)]: res.entries ?? [] }));
    if (root === "workspace" && dirPath === "cases") {
      setCasesDirProbe("ok");
    }
    return res.entries ?? [];
  }, []);

  // Recursively index all files for quick-open (depth-limited).
  const indexRoot = useCallback(
    async (root: RootKey) => {
      const collected: IndexedFile[] = [];
      async function walk(dirPath: string, depth: number) {
        if (depth > 5) {return;}
        const res = await window.lawmindDesktop?.fsList({ root, path: dirPath });
        if (!res?.ok || !res.entries) {return;}
        setChildrenByDir((prev) => ({ ...prev, [keyOf(root, dirPath)]: res.entries ?? [] }));
        const dirs: string[] = [];
        for (const e of res.entries) {
          if (e.kind === "file") {
            if (shouldShowExplorerFile(root, e.path)) {
              collected.push({ root, path: e.path, name: e.name });
            }
          } else if (shouldShowExplorerDirectory(root, e.path)) {
            dirs.push(e.path);
          }
        }
        await Promise.all(dirs.map((d) => walk(d, depth + 1)));
      }
      await walk("", 0);
      return collected;
    },
    [],
  );

  const refreshIndex = useCallback(async () => {
    try {
      const ws = (await indexRoot("workspace")) ?? [];
      setIndexedFiles(ws);
    } catch {
      // silently ignore indexing errors
    }
  }, [indexRoot]);

  useEffect(() => {
    void refreshIndex();
  }, [refreshIndex]);

  useEffect(() => {
    void (async () => {
      try {
        await loadDir("workspace", "");
      } catch {
        /* 工作区根不可用 */
      }
      try {
        await loadDir("workspace", "cases");
        setCasesDirProbe("ok");
      } catch {
        setCasesDirProbe("missing");
      }
      void refreshIndex();
    })();
  }, [loadDir, workspaceTreeRefreshKey, refreshIndex]);

  // ── Save ─────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveActive = useCallback(async () => {
    if (!activeTab) {return;}
    if (activeTab.content === activeTab.savedContent) {
      setError(null);
      return;
    }
    setBusy(true);
    try {
      const res = await window.lawmindDesktop?.fsWrite({
        root: activeTab.root, path: activeTab.path,
        content: activeTab.content, expectedMtimeMs: activeTab.mtimeMs,
      });
      if (!res?.ok || typeof res.mtimeMs !== "number") {
        if (res?.conflict) {throw new Error("文件已被外部修改，请重新打开后合并。");}
        throw new Error(res?.error ?? "保存失败");
      }
      setTabs((prev) => prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, savedContent: activeTab.content, mtimeMs: res.mtimeMs ?? t.mtimeMs }
          : t,
      ));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeTab]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveActiveAs = useCallback(async () => {
    if (!activeTab) {
      return;
    }
    setBusy(true);
    try {
      const res = await window.lawmindDesktop?.saveTextFileDialog({
        content: activeTab.content,
        defaultName: activeTab.name,
      });
      if (!res?.ok || res.canceled || !res.filePath) {
        return;
      }
      const mapped = resolveRelForAbs(workspaceDir, projectDir, res.filePath);
      if (mapped) {
        const rd = await window.lawmindDesktop?.fsRead({ root: mapped.root, path: mapped.rel });
        if (rd?.ok && typeof rd.mtimeMs === "number" && typeof rd.content === "string") {
          const newId = `${mapped.root}:${mapped.rel}`;
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTab.id
                ? {
                    ...t,
                    id: newId,
                    root: mapped.root,
                    path: mapped.rel,
                    name: basename(mapped.rel) || t.name,
                    content: rd.content!,
                    savedContent: rd.content!,
                    mtimeMs: rd.mtimeMs!,
                  }
                : t,
            ),
          );
          setActiveTabId(newId);
          setSelected({ root: mapped.root, path: mapped.rel, kind: "file" });
        } else {
          setError("另存为成功，但无法从工作区重新读取文件。");
        }
      } else {
        setError(`已保存到工作区外：${res.filePath}（可继续在编辑器中编辑当前标签；保存仍指向原文件路径。）`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeTab, workspaceDir, projectDir]);

  // ── Keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowQuickOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActiveAs();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void saveActive();
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setInlineInput(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, saveActiveAs]);

  useEffect(() => {
    const off = window.lawmindDesktop?.onFileMenu?.((payload) => {
      const a = String(payload?.action ?? "");
      if (a === "save") {
        void saveActive();
      }
      if (a === "save-as") {
        void saveActiveAs();
      }
    });
    return () => {
      off?.();
    };
  }, [saveActive, saveActiveAs]);

  const refreshDir = useCallback(async (root: RootKey, dirPath: string) => {
    try {
      await loadDir(root, dirPath);
      void refreshIndex();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadDir, refreshIndex]);

  const toggleDir = async (root: RootKey, dirPath: string) => {
    const k = keyOf(root, dirPath);
    const nextOpen = !expanded[k];
    setExpanded((prev) => ({ ...prev, [k]: nextOpen }));
    if (nextOpen) {await refreshDir(root, dirPath);}
  };

  const openFile = useCallback(async (root: RootKey, relPath: string) => {
    if (isOfficeLikePath(relPath)) {
      setOfficeBlock({ root, relPath, name: basename(relPath) });
      setActiveTabId(null);
      setSelected({ root, path: relPath, kind: "file" });
      setError(null);
      return;
    }
    const tabId = `${root}:${relPath}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      setOfficeBlock(null);
      setActiveTabId(existing.id);
      return;
    }
    setBusy(true);
    try {
      const res = await window.lawmindDesktop?.fsRead({ root, path: relPath });
      if (!res?.ok || typeof res.content !== "string" || typeof res.mtimeMs !== "number") {
        const errText = res?.error ?? "文件读取失败";
        if (errText.toLowerCase().includes("binary") && isOfficeLikePath(relPath)) {
          setOfficeBlock({ root, relPath, name: basename(relPath) });
          setActiveTabId(null);
          setSelected({ root, path: relPath, kind: "file" });
          setError(null);
          return;
        }
        throw new Error(errText);
      }
      setOfficeBlock(null);
      const tab: OpenFileTab = {
        id: tabId, root, path: relPath, name: basename(relPath),
        content: res.content, savedContent: res.content, mtimeMs: res.mtimeMs,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      setSelected({ root, path: relPath, kind: "file" });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [tabs]);

  // ── Close tab ────────────────────────────────────────────────
  const closeTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) {return;}
    if (tab.content !== tab.savedContent) {
      setConfirmDialog({
        kind: "simple",
        message: `文件 "${tab.name}" 有未保存修改，确认关闭？`,
        onConfirm: () => {
          setTabs((prev) => {
            const next = prev.filter((t) => t.id !== tabId);
            if (activeTabId === tabId) {setActiveTabId(next[next.length - 1]?.id ?? null);}
            return next;
          });
          setConfirmDialog(null);
        },
      });
      return;
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {setActiveTabId(next[next.length - 1]?.id ?? null);}
      return next;
    });
  };

  const updateActiveContent = (next: string) => {
    if (!activeTab) {return;}
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, content: next } : t)));
  };

  // ── File operations ──────────────────────────────────────────
  const doCreateFile = async (root: RootKey, parentDir: string, name: string) => {
    const relPath = joinRelPath(parentDir, name);
    const res = await window.lawmindDesktop?.fsWrite({ root, path: relPath, content: "" });
    if (!res?.ok) { setError(res?.error ?? "新建文件失败"); return; }
    await refreshDir(root, parentDir);
    await openFile(root, relPath);
  };

  const doCreateFolder = async (root: RootKey, parentDir: string, name: string) => {
    const relPath = joinRelPath(parentDir, name);
    const res = await window.lawmindDesktop?.fsMkdir({ root, path: relPath });
    if (!res?.ok) { setError(res?.error ?? "新建文件夹失败"); return; }
    await refreshDir(root, parentDir);
    setExpanded((prev) => ({ ...prev, [keyOf(root, parentDir)]: true }));
  };

  const doRename = async (root: RootKey, oldPath: string, newName: string) => {
    const newPath = joinRelPath(getDirname(oldPath), newName);
    const res = await window.lawmindDesktop?.fsRename({ root, fromPath: oldPath, toPath: newPath });
    if (!res?.ok) { setError(res?.error ?? "重命名失败"); return; }
    await refreshDir(root, getDirname(oldPath));
    const oldTabId = `${root}:${oldPath}`;
    setTabs((prev) => prev.map((t) =>
      t.id === oldTabId ? { ...t, id: `${root}:${newPath}`, path: newPath, name: basename(newPath) } : t,
    ));
    if (activeTabId === oldTabId) {setActiveTabId(`${root}:${newPath}`);}
    setSelected((prev) => (prev?.path === oldPath && prev.root === root ? { ...prev, path: newPath } : prev));
  };

  const doDelete = async (root: RootKey, relPath: string) => {
    const res = await window.lawmindDesktop?.fsDelete({ root, path: relPath });
    if (!res?.ok) { setError(res?.error ?? "删除失败"); return; }
    await refreshDir(root, getDirname(relPath));
    const prefix = `${root}:${relPath}`;
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== prefix && !t.id.startsWith(`${prefix}/`));
      if (!next.find((t) => t.id === activeTabId)) {setActiveTabId(next[next.length - 1]?.id ?? null);}
      return next;
    });
    setSelected((prev) =>
      prev?.root === root && (prev.path === relPath || prev.path.startsWith(`${relPath}/`)) ? null : prev,
    );
  };

  const moveWorkspaceItemIntoMatter = useCallback(
    async (matterId: string, relPath: string, kind: "file" | "directory") => {
      if (!canUseFilesystemBridge) {return;}
      const mid = matterId.trim();
      if (!isValidMatterId(mid)) {
        setError("案件编号格式无效，请检查输入。");
        setAddToMatterLastError("案件编号格式无效，请检查输入。");
        return;
      }
      if (moveIntoMatterInFlightRef.current) {return;}
      moveIntoMatterInFlightRef.current = true;
      setContextMenu(null);
      setBusy(true);
      setError(null);
      setAddToMatterLastError(null);
      try {
        const caseDir = joinRelPath("cases", mid);
        const mk = await window.lawmindDesktop?.fsMkdir({ root: "workspace", path: caseDir });
        if (mk && !mk.ok) {
          throw new Error(mk.error ?? "无法创建案件目录");
        }
        const leaf = basename(relPath);
        const desired = joinRelPath(caseDir, leaf);
        const toPath = await allocateNonCollidingRelPath("workspace", desired, kind);
        const res = await window.lawmindDesktop?.fsRename({
          root: "workspace",
          fromPath: relPath,
          toPath,
        });
        if (!res?.ok) {
          throw new Error(res?.error ?? "移动失败");
        }
        await refreshDir("workspace", getDirname(relPath));
        await refreshDir("workspace", caseDir);
        void refreshIndex();
        const oldTabPrefix = `workspace:${relPath}`;
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path === relPath) {
              return { ...t, id: `workspace:${toPath}`, path: toPath, name: basename(toPath) };
            }
            if (t.path.startsWith(`${relPath}/`)) {
              const suffix = t.path.slice(relPath.length + 1);
              const np = joinRelPath(toPath, suffix);
              return { ...t, id: `workspace:${np}`, path: np, name: basename(np) };
            }
            return t;
          }),
        );
        setActiveTabId((id) => (id === oldTabPrefix ? `workspace:${toPath}` : id));
        setAddToMatterPick(null);
        setAddToMatterManualDraft("");
        setAddToMatterLastError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setAddToMatterLastError(msg);
      } finally {
        moveIntoMatterInFlightRef.current = false;
        setBusy(false);
      }
    },
    [canUseFilesystemBridge, refreshDir, refreshIndex],
  );

  const moveCaseItemToWorkspaceRoot = useCallback(
    (relPath: string, kind: "file" | "directory") => {
      if (!canUseFilesystemBridge) {return;}
      setContextMenu(null);
      const parsed = parseCasesRelForWorkspaceMove(relPath);
      if (!parsed) {return;}
      const { firstSeg, workspaceDestRel } = parsed;
      const body =
        workspaceDestRel === ""
          ? `将卷宗文件夹「${firstSeg}」整体移到工作区根目录（磁盘文件保留，仅从 cases 下移出）。若名称冲突将自动追加序号。`
          : `将「${workspaceDestRel}」移到工作区根目录下（保持相对路径结构）。重名时自动追加序号。`;
      setConfirmDialog({
        kind: "simple",
        message: body,
        onConfirm: () => {
          setConfirmDialog(null);
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const toPath =
                workspaceDestRel === ""
                  ? await allocateNonCollidingRelPath("workspace", firstSeg, "directory")
                  : await allocateNonCollidingRelPath("workspace", workspaceDestRel, kind);
              const res = await window.lawmindDesktop?.fsRename({
                root: "workspace",
                fromPath: relPath,
                toPath,
              });
              if (!res?.ok) {
                throw new Error(res?.error ?? "移动失败");
              }
              const destParent = getDirname(toPath);
              await refreshDir("workspace", "cases");
              await refreshDir("workspace", destParent || "");
              void refreshIndex();
              const oldTabPrefix = `workspace:${relPath}`;
              setTabs((prev) =>
                prev.map((t) => {
                  if (t.path === relPath) {
                    return { ...t, id: `workspace:${toPath}`, path: toPath, name: basename(toPath) };
                  }
                  if (t.path.startsWith(`${relPath}/`)) {
                    const suffix = t.path.slice(relPath.length + 1);
                    const np = joinRelPath(toPath, suffix);
                    return { ...t, id: `workspace:${np}`, path: np, name: basename(np) };
                  }
                  return t;
                }),
              );
              setActiveTabId((id) => (id === oldTabPrefix ? `workspace:${toPath}` : id));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    },
    [canUseFilesystemBridge, refreshDir, refreshIndex],
  );

  // ── Context-menu initiated actions ───────────────────────────
  const startCreate = (root: RootKey, parentDir: string, kind: "file" | "folder") => {
    setContextMenu(null);
    setInlineInput({
      root, parentDir, kind, initialValue: "",
      onDone: async (name) => {
        setInlineInput(null);
        if (!name.trim()) {return;}
        if (kind === "file") {await doCreateFile(root, parentDir, name.trim());}
        else {await doCreateFolder(root, parentDir, name.trim());}
      },
    });
  };

  const startRename = (root: RootKey, relPath: string) => {
    setContextMenu(null);
    const current = basename(relPath);
    const parentDir = getDirname(relPath);
    setInlineInput({
      root, parentDir, kind: "file", initialValue: current,
      onDone: async (name) => {
        setInlineInput(null);
        if (!name.trim() || name.trim() === current) {return;}
        await doRename(root, relPath, name.trim());
      },
    });
  };

  const requestDelete = (root: RootKey, relPath: string, kind: "file" | "directory") => {
    setContextMenu(null);
    const name = basename(relPath);
    const protectedNote = isProtectedWorkspacePath(root, relPath);
    if (protectedNote) {
      setDangerInput("");
      setConfirmDialog({
        kind: "danger",
        title: `⚠️ 删除受保护${kind === "directory" ? "目录" : "文件"}`,
        body: `"${name}" 是核心工作区文件，律师确认操作：\n\n${protectedNote}\n\n请在下方输入文件名 "${name}" 确认删除：`,
        confirmLabel: "永久删除",
        onConfirm: () => { setConfirmDialog(null); void doDelete(root, relPath); },
      });
    } else {
      setConfirmDialog({
        kind: "simple",
        message: kind === "directory"
          ? `确认删除文件夹 "${name}" 及其所有内容？此操作不可撤销。`
          : `确认删除文件 "${name}"？此操作不可撤销。`,
        onConfirm: () => { setConfirmDialog(null); void doDelete(root, relPath); },
      });
    }
  };

  const doShowInFolder = async (root: RootKey, relPath: string) => {
    setContextMenu(null);
    if (!canUseFilesystemBridge) {return;}
    const base = root === "workspace" ? workspaceDir : projectDir;
    if (!base) {return;}
    const full = relPath
      ? `${base.replace(/\/+$/, "")}/${relPath}`.replace(/\\/g, "/")
      : base.replace(/\\/g, "/");
    await window.lawmindDesktop?.showItemInFolder(full);
  };

  const pasteInto = useCallback(
    async (root: RootKey, parentDir: string) => {
      if (!fsClip || fsClip.root !== root) {
        setError("只能粘贴到同一根目录（工作区与项目之间不能混贴）。");
        setContextMenu(null);
        return;
      }
      setContextMenu(null);
      setBusy(true);
      try {
        const sources = [...fsClip.relPaths];
        for (const from of sources) {
          const fromName = basename(from);
          const fromParent = getDirname(from);
          const listFrom = await window.lawmindDesktop?.fsList({ root, path: fromParent });
          if (!listFrom?.ok) {
            throw new Error(listFrom?.error ?? "无法读取源目录");
          }
          const srcEntry = listFrom.entries?.find((e) => e.path === from);
          const srcKind = srcEntry?.kind ?? "file";
          const toRel = await allocateNonCollidingChildPath(root, parentDir, fromName, srcKind);
          const res = await window.lawmindDesktop?.fsCopy({ root, fromPath: from, toPath: toRel });
          if (!res?.ok) {
            throw new Error(res?.error ?? "粘贴失败");
          }
        }
        if (fsClip.op === "cut") {
          for (const p of sources) {
            const del = await window.lawmindDesktop?.fsDelete({ root, path: p });
            if (!del?.ok) {
              throw new Error(del?.error ?? "移动时删除源失败");
            }
          }
          setFsClip(null);
        }
        await refreshDir(root, parentDir);
        void refreshIndex();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [fsClip, refreshDir, refreshIndex],
  );

  const copyPath = (root: RootKey, relPath: string) => {
    setContextMenu(null);
    setFsClip({ op: "copy", root, relPaths: [relPath] });
  };

  const cutPath = (root: RootKey, relPath: string) => {
    setContextMenu(null);
    setFsClip({ op: "cut", root, relPaths: [relPath] });
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const h = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [contextMenu]);

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
