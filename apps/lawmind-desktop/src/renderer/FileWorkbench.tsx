import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type Props = {
  workspaceDir: string;
  projectDir: string | null;
  canUseFilesystemBridge: boolean;
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
  if (root !== "workspace") {return null;}
  const top = relPath.split("/")[0];
  return top ? (PROTECTED_WORKSPACE[top] ?? null) : null;
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
      className="lm-wizard-backdrop"
      style={{ alignItems: "flex-start", paddingTop: "14vh" }}
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
  const { workspaceDir, projectDir, canUseFilesystemBridge } = props;

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

  const menuRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

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
    return res.entries ?? [];
  }, []);

  // Recursively index all files for quick-open (depth-limited).
  const indexRoot = useCallback(async (root: RootKey) => {
    const collected: IndexedFile[] = [];
    async function walk(dirPath: string, depth: number) {
      if (depth > 5) {return;}
      const res = await window.lawmindDesktop?.fsList({ root, path: dirPath });
      if (!res?.ok || !res.entries) {return;}
      setChildrenByDir((prev) => ({ ...prev, [keyOf(root, dirPath)]: res.entries ?? [] }));
      const dirs: string[] = [];
      for (const e of res.entries) {
        if (e.kind === "file") {
          collected.push({ root, path: e.path, name: e.name });
        } else {
          dirs.push(e.path);
        }
      }
      await Promise.all(dirs.map((d) => walk(d, depth + 1)));
    }
    await walk("", 0);
    return collected;
  }, []);

  const refreshIndex = useCallback(async () => {
    try {
      const ws = (await indexRoot("workspace")) ?? [];
      const proj = projectDir ? ((await indexRoot("project")) ?? []) : [];
      setIndexedFiles([...ws, ...proj]);
    } catch {
      // silently ignore indexing errors
    }
  }, [indexRoot, projectDir]);

  useEffect(() => {
    void refreshIndex();
  }, [refreshIndex]);

  // ── Save ─────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveActive = useCallback(async () => {
    if (!activeTab) {return;}
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

  // ── Keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowQuickOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
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
  }, [saveActive]);

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
    const tabId = `${root}:${relPath}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) { setActiveTabId(existing.id); return; }
    setBusy(true);
    try {
      const res = await window.lawmindDesktop?.fsRead({ root, path: relPath });
      if (!res?.ok || typeof res.content !== "string" || typeof res.mtimeMs !== "number") {
        throw new Error(res?.error ?? "文件读取失败");
      }
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
    const full = `${base.replace(/\/+$/, "")}/${relPath}`.replace(/\\/g, "/");
    await window.lawmindDesktop?.showItemInFolder(full);
  };

  // ── File tree render ─────────────────────────────────────────
  const renderTree = (root: RootKey, dirPath: string, level: number): ReactNode => {
    const k = keyOf(root, dirPath);
    const entries = childrenByDir[k] ?? [];
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
        nodes.push(
          <div key={entry.path}>
            <button
              type="button"
              className={`lm-fs-node lm-fs-dir ${isSelected ? "active" : ""} ${isProtected ? "protected" : ""}`}
              style={{ paddingLeft: pad }}
              title={isProtected ? "⚠️ 受保护目录" : entry.name}
              onClick={() => { setSelected({ root, path: entry.path, kind: "directory" }); void toggleDir(root, entry.path); }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, root, path: entry.path, kind: "directory", isRoot: false }); }}
            >
              <span className={`lm-fs-arrow ${isOpen ? "open" : ""}`}>▸</span>
              <span className="lm-fs-icon">{getFileIcon(entry.name, "directory", isOpen)}</span>
              <span className="lm-fs-name">{entry.name}</span>
              {isProtected && <span className="lm-fs-lock">🔒</span>}
            </button>
            {isOpen && renderTree(root, entry.path, level + 1)}
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
  const renderConfirmDialog = () => {
    if (!confirmDialog) {return null;}
    if (confirmDialog.kind === "simple") {
      return (
        <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
          <div className="lm-wizard" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <p style={{ marginBottom: 20, lineHeight: 1.7 }}>{confirmDialog.message}</p>
            <div className="lm-wizard-actions">
              <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
              <button type="button" className="lm-btn" style={{ background: "var(--error)" }} onClick={confirmDialog.onConfirm}>确认</button>
            </div>
          </div>
        </div>
      );
    }
    const requiredName = confirmDialog.body.match(/"([^"]+)" 确认删除：/)?.[1] ?? "";
    const canConfirm = !requiredName || dangerInput.trim() === requiredName;
    return (
      <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
        <div className="lm-wizard" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ color: "var(--error)", fontSize: 15, marginBottom: 10 }}>{confirmDialog.title}</h2>
          <p style={{ whiteSpace: "pre-line", color: "var(--text-2)", fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>{confirmDialog.body}</p>
          {requiredName && (
            <div className="lm-field" style={{ marginBottom: 16 }}>
              <input
                type="text"
                value={dangerInput}
                placeholder={`输入"${requiredName}"确认`}
                onChange={(e) => setDangerInput(e.target.value)}
                style={{ borderColor: canConfirm ? "var(--accent-border)" : "var(--error)" }}
              />
            </div>
          )}
          <div className="lm-wizard-actions">
            <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
            <button type="button" className="lm-btn" style={{ background: "var(--error)", opacity: canConfirm ? 1 : 0.4 }} disabled={!canConfirm} onClick={confirmDialog.onConfirm}>
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
    return (
      <div ref={menuRef} className="lm-context-menu" style={{ top: y, left: x }} onContextMenu={(e) => e.preventDefault()}>
        <button type="button" onClick={() => startCreate(root, parentDir, "file")}>📄 新建文件</button>
        <button type="button" onClick={() => startCreate(root, parentDir, "folder")}>📁 新建文件夹</button>
        {ctxPath && (
          <>
            <div className="lm-context-menu-sep" />
            <button type="button" onClick={() => startRename(root, ctxPath)}>✏️ 重命名</button>
            <button
              type="button"
              className={isProtectedWorkspacePath(root, ctxPath) ? "danger" : ""}
              onClick={() => requestDelete(root, ctxPath, kind)}
            >
              🗑️ 删除{isProtectedWorkspacePath(root, ctxPath) ? " ⚠️" : ""}
            </button>
          </>
        )}
        <div className="lm-context-menu-sep" />
        <button type="button" onClick={() => void doShowInFolder(root, ctxPath)}>📂 在访达中显示</button>
        <button type="button" onClick={() => { setContextMenu(null); void refreshDir(root, ctxPath && kind === "file" ? getDirname(ctxPath) : ctxPath); }}>🔄 刷新</button>
      </div>
    );
  };

  const renderRootHeader = (root: RootKey, label: string, subtitle: string) => (
    <div
      className="lm-fs-root-header"
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, root, path: "", kind: "directory", isRoot: true }); }}
    >
      <span className="lm-section-label">{label}</span>
      <span className="lm-fs-root-path" title={subtitle}>{subtitle.split(/[/\\]/).pop()}</span>
      <button type="button" className="lm-fs-root-add" title="新建文件" onClick={() => startCreate(root, "", "file")}>＋</button>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="lm-files-layout" onClick={() => setContextMenu(null)}>
      {/* ── Explorer sidebar ── */}
      <aside className="lm-files-explorer" onClick={(e) => e.stopPropagation()}>
        {/* Quick open button */}
        <button
          type="button"
          className="lm-quickopen-trigger"
          onClick={() => setShowQuickOpen(true)}
        >
          <span>🔍</span>
          <span>快速打开文件…</span>
          <kbd>⌘P</kbd>
        </button>

        <div className="lm-fs-section">
          {renderRootHeader("workspace", "工作区", workspaceDir)}
          {renderTree("workspace", "", 0)}
        </div>

        {projectDir && (
          <div className="lm-fs-section">
            {renderRootHeader("project", "项目目录", projectDir)}
            {renderTree("project", "", 0)}
          </div>
        )}

        {error && (
          <div className="lm-error" style={{ marginTop: 8, fontSize: 11 }}>
            {error}
            <button type="button" style={{ marginLeft: 8, cursor: "pointer", border: "none", background: "none", color: "var(--error)" }} onClick={() => setError(null)}>×</button>
          </div>
        )}
      </aside>

      {/* ── Editor area ── */}
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
                onClick={() => setActiveTabId(tab.id)}
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
                <span className="lm-send-hint">⌘S</span>
                <button type="button" className="lm-btn lm-btn-sm" disabled={busy || !activeDirty} onClick={() => void saveActive()}>保存</button>
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
        ) : (
          <div className="lm-editor-empty">
            <div className="lm-messages-empty-icon">📂</div>
            <div className="lm-messages-empty-title">选择文件开始编辑</div>
            <div className="lm-messages-empty-hint">在左侧文件树中点击文件，或按 ⌘P 快速搜索</div>
          </div>
        )}
      </section>

      {/* ── Floating context menu ── */}
      {renderContextMenu()}

      {/* ── Confirm / danger dialogs ── */}
      {renderConfirmDialog()}

      {/* ── Quick Open Modal ── */}
      {showQuickOpen && (
        <QuickOpenModal
          files={indexedFiles}
          onOpen={(root, path) => void openFile(root, path)}
          onClose={() => setShowQuickOpen(false)}
        />
      )}
    </div>
  );
}
