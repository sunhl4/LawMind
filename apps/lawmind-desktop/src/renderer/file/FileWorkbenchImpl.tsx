import { useCallback, useEffect, useRef, useState } from "react";
import {
  type RootKey,
  type FsEntry,
  type OpenFileTab,
  type IndexedFile,
  type ContextMenu,
  type ConfirmDialog,
  type InlineInput,
  type FsClip,
  type FileWorkbenchCasesNodeActions,
  type FileWorkbenchProps,
} from "./file-workbench-types";
export type { FileWorkbenchCasesNodeActions, FileWorkbenchProps } from "./file-workbench-types";
import {
  isProtectedWorkspacePath,
  isOfficeLikePath,
  keyOf,
  basename,
  getDirname,
  joinRelPath,
  parseCasesRelForWorkspaceMove,
  allocateNonCollidingChildPath,
  allocateNonCollidingRelPath,
  resolveRelForAbs,
} from "./file-workbench-fs";
import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";
import {
  shouldShowExplorerDirectory,
  shouldShowExplorerFile,
} from "../lawmind-explorer-lawyer-view";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "../lawmind-panel-layout";
import { usePaneResizePx } from "../use-pane-resize";
import { FileWorkbenchView } from "./FileWorkbenchView";

export function FileWorkbench(props: FileWorkbenchProps) {
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
  return (
    <FileWorkbenchView
      workspaceDir={workspaceDir}
      projectDir={projectDir}
      canUseFilesystemBridge={canUseFilesystemBridge}
      onAddToChatContext={onAddToChatContext}
      portalHosts={portalHosts}
      workspaceExplorerToolbar={workspaceExplorerToolbar}
      casesNodeActions={casesNodeActions}
      mattersPickList={mattersPickList}
      childrenByDir={childrenByDir}
      expanded={expanded}
      selected={selected}
      setSelected={setSelected}
      tabs={tabs}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      busy={busy}
      setBusy={setBusy}
      error={error}
      setError={setError}
      contextMenu={contextMenu}
      setContextMenu={setContextMenu}
      confirmDialog={confirmDialog}
      setConfirmDialog={setConfirmDialog}
      inlineInput={inlineInput}
      setInlineInput={setInlineInput}
      dangerInput={dangerInput}
      setDangerInput={setDangerInput}
      showQuickOpen={showQuickOpen}
      setShowQuickOpen={setShowQuickOpen}
      indexedFiles={indexedFiles}
      fsClip={fsClip}
      officeBlock={officeBlock}
      setOfficeBlock={setOfficeBlock}
      addToMatterPick={addToMatterPick}
      setAddToMatterPick={setAddToMatterPick}
      addToMatterManualDraft={addToMatterManualDraft}
      setAddToMatterManualDraft={setAddToMatterManualDraft}
      addToMatterLastError={addToMatterLastError}
      setAddToMatterLastError={setAddToMatterLastError}
      casesDirProbe={casesDirProbe}
      workSectionOpen={workSectionOpen}
      setWorkSectionOpen={setWorkSectionOpen}
      casesSectionOpen={casesSectionOpen}
      setCasesSectionOpen={setCasesSectionOpen}
      filesExplorerWidth={filesExplorerWidth}
      onFilesExplorerResize={onFilesExplorerResize}
      explorerUsesRailLayout={explorerUsesRailLayout}
      menuRef={menuRef}
      inlineInputRef={inlineInputRef}
      activeTab={activeTab}
      activeDirty={activeDirty}
      toggleDir={toggleDir}
      openFile={openFile}
      closeTab={closeTab}
      updateActiveContent={updateActiveContent}
      saveActive={saveActive}
      saveActiveAs={saveActiveAs}
      startCreate={startCreate}
      startRename={startRename}
      requestDelete={requestDelete}
      doShowInFolder={doShowInFolder}
      pasteInto={pasteInto}
      moveWorkspaceItemIntoMatter={moveWorkspaceItemIntoMatter}
      moveCaseItemToWorkspaceRoot={moveCaseItemToWorkspaceRoot}
      copyPath={copyPath}
      cutPath={cutPath}
      refreshDir={refreshDir}
    />
  );
}
