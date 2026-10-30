/**
 * 主窗口 / 独立 pane 窗共用的面板状态。
 *
 * 把「侧栏与对话/中栏显隐、拆出跟踪、独立窗首帧上下文」从 `lawmind-app-root.tsx`
 * 抽出来：根壳只负责把这些状态接到布局和 header 上。独立窗里这些状态不写回
 * localStorage，避免把主窗口的版面偏好改掉。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { LawmindMainView } from "../lawmind-main-view";
import type {
  LawmindWorkspacePaneRoute,
} from "../lawmind-popout-route";
import {
  LM_PANE_MAX_WIDTH_PX,
  LM_PANE_MIN_WIDTH_PX,
  readStoredBool,
  writeStoredBool,
} from "../lawmind-panel-layout";
import { usePaneResizePx } from "../use-pane-resize";
import {
  workspacePaneTitle,
  workspacePaneFromWindowKey,
  type LawmindPaneDetachBridge,
} from "../lawmind-pane-window";
import {
  requestOpenDraftDesk,
} from "../lawmind-open-contract-revision";
import {
  requestOpenWorkspaceFile,
  type WorkspaceFileRoot,
} from "../lawmind-workspace-file-open";
import { takeDetachedFileTab } from "../lawmind-detached-file-tabs";

export type LawmindPaneWindowControllerInput = {
  paneWindow?: LawmindWorkspacePaneRoute;
  configApiBase?: string;
  mainView: LawmindMainView;
  matterCockpitOpen: boolean;
  canUseFilesystemBridge: boolean;
  loading: boolean;
  setContextMatterId: (id: string | null) => void;
  setSelectedMatterKey: (key: string) => void;
  setMatterCockpitOpen: (open: boolean) => void;
  selectChatSession: (sessionId: string, assistantId?: string) => Promise<void> | void;
  reloadActiveChatSession: () => Promise<void> | void;
  /** 收回对话窗时接上仍在跑的回合（live trace），别只留一次快照。 */
  resumeLiveChat?: () => void;
};

export type LawmindPaneWindowController = {
  windowTitle: string;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  onSidebarResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  wsShowEditor: boolean;
  wsShowChat: boolean;
  wsChatColWidth: number;
  onWsChatSplitResize: (event: ReactPointerEvent) => void;
  setWsShowEditor: Dispatch<SetStateAction<boolean>>;
  setWsShowChat: Dispatch<SetStateAction<boolean>>;
  setWsShowEditorRespectingDetach: Dispatch<SetStateAction<boolean>>;
  setWsShowChatRespectingDetach: Dispatch<SetStateAction<boolean>>;
  paneDetach: LawmindPaneDetachBridge | null;
};

export function useLawmindPaneWindowController(
  input: LawmindPaneWindowControllerInput,
): LawmindPaneWindowController {
  const {
    paneWindow,
    configApiBase,
    mainView,
    matterCockpitOpen,
    canUseFilesystemBridge,
    loading,
    setContextMatterId,
    setSelectedMatterKey,
    setMatterCockpitOpen,
    selectChatSession,
    reloadActiveChatSession,
    resumeLiveChat,
  } = input;

  const paneMode = paneWindow?.pane ?? null;
  const isPaneWindow = paneMode !== null;

  useEffect(() => {
    if (!paneMode) {
      return;
    }
    document.title = `${workspacePaneTitle(paneMode, paneWindow?.title)} — LawMind`;
  }, [paneMode, paneWindow?.title]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    isPaneWindow ? true : readStoredBool("lawmind.ui.sidebarCollapsed", false),
  );

  useEffect(() => {
    if (!isPaneWindow) {
      writeStoredBool("lawmind.ui.sidebarCollapsed", sidebarCollapsed);
    }
  }, [isPaneWindow, sidebarCollapsed]);

  const { width: sidebarWidth, onResizePointerDown: onSidebarResizePointerDown } = usePaneResizePx({
    storageKey: "lawmind.ui.sidebarWidth",
    defaultWidth: 348,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
    widthRole: "shellSidebar",
  });

  const { width: wsChatColWidth, onResizePointerDown: onWsChatSplitResize } = usePaneResizePx({
    storageKey: "lawmind.ui.wsChatColumnWidth",
    defaultWidth: 380,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
    // 对话列在分隔条右侧。往右拖必须让这一列变窄，分隔条才跟着鼠标走。
    edge: "trailing",
  });

  const [wsShowEditor, setWsShowEditor] = useState(() =>
    paneMode === "middle"
      ? true
      : paneMode === "chat"
        ? false
        : readStoredBool("lawmind.ui.wsPaneEditor", false),
  );
  const [wsShowChat, setWsShowChat] = useState(() =>
    paneMode === "chat"
      ? true
      : paneMode === "middle"
        ? false
        : readStoredBool("lawmind.ui.wsPaneChat", true),
  );

  useEffect(() => {
    if (!isPaneWindow) {
      writeStoredBool("lawmind.ui.wsPaneEditor", wsShowEditor);
    }
  }, [isPaneWindow, wsShowEditor]);
  useEffect(() => {
    if (!isPaneWindow) {
      writeStoredBool("lawmind.ui.wsPaneChat", wsShowChat);
    }
  }, [isPaneWindow, wsShowChat]);

  /** 独立窗只首帧定位一次；之后用户在窗内切会话/切案不再被拉回。 */
  const initialPaneChatSessionRef = useRef(false);
  const initialPaneDraftRef = useRef(false);
  const initialPaneFileRef = useRef(false);

  useEffect(() => {
    if (!isPaneWindow) {
      return;
    }
    const matterId = paneWindow?.matterId?.trim();
    if (!matterId) {
      return;
    }
    setContextMatterId(matterId);
    setSelectedMatterKey(matterId);
  }, [
    isPaneWindow,
    paneWindow?.matterId,
    setContextMatterId,
    setSelectedMatterKey,
  ]);

  useEffect(() => {
    if (!isPaneWindow || paneMode !== "chat") {
      return;
    }
    const sessionId = paneWindow?.sessionId?.trim();
    if (!sessionId || !configApiBase || initialPaneChatSessionRef.current) {
      return;
    }
    initialPaneChatSessionRef.current = true;
    void selectChatSession(sessionId, paneWindow?.assistantId?.trim() || undefined);
  }, [
    configApiBase,
    isPaneWindow,
    paneMode,
    paneWindow?.assistantId,
    paneWindow?.sessionId,
    selectChatSession,
  ]);

  useEffect(() => {
    if (!isPaneWindow || paneMode !== "middle") {
      return;
    }
    const draftTaskId = paneWindow?.draftTaskId?.trim();
    if (!draftTaskId || initialPaneDraftRef.current) {
      return;
    }
    initialPaneDraftRef.current = true;
    setMatterCockpitOpen(false);
    requestOpenDraftDesk(draftTaskId);
  }, [isPaneWindow, paneMode, paneWindow?.draftTaskId, setMatterCockpitOpen]);

  useEffect(() => {
    if (!isPaneWindow || paneMode !== "middle") {
      return;
    }
    const relPath = paneWindow?.relPath?.trim();
    if (!relPath || paneWindow?.draftTaskId?.trim() || initialPaneFileRef.current) {
      return;
    }
    initialPaneFileRef.current = true;
    setMatterCockpitOpen(false);
    setWsShowEditor(true);
    requestOpenWorkspaceFile(
      relPath,
      (paneWindow?.root?.trim() || "workspace") as WorkspaceFileRoot,
    );
  }, [
    isPaneWindow,
    paneMode,
    paneWindow?.draftTaskId,
    paneWindow?.relPath,
    paneWindow?.root,
    setMatterCockpitOpen,
  ]);

  useEffect(() => {
    if (isPaneWindow || mainView !== "workspace" || matterCockpitOpen) {
      return;
    }
    const editorVisible = canUseFilesystemBridge && wsShowEditor;
    if (!wsShowChat && !editorVisible) {
      setWsShowChat(true);
    }
  }, [
    canUseFilesystemBridge,
    isPaneWindow,
    mainView,
    matterCockpitOpen,
    wsShowChat,
    wsShowEditor,
  ]);

  /**
   * 拖出去的 pane 在主窗口先「让位」，关掉独立窗再回来。
   * 这里只跟踪 key，不改用户的显隐偏好；关闭最后一个同 pane 的窗口即自动复原。
   */
  const [detachedChatKeys, setDetachedChatKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [detachedMiddleKeys, setDetachedMiddleKeys] = useState<ReadonlySet<string>>(() => new Set());

  const handleChatPaneDetached = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) {
      return;
    }
    setDetachedChatKeys((prev) => (prev.has(trimmed) ? prev : new Set(prev).add(trimmed)));
  }, []);

  const handleMiddlePaneDetached = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) {
      return;
    }
    setDetachedMiddleKeys((prev) => (prev.has(trimmed) ? prev : new Set(prev).add(trimmed)));
  }, []);

  useEffect(() => {
    if (isPaneWindow) {
      return undefined;
    }
    const unsubscribe = window.lawmindDesktop?.onAuxWindowClosed?.((payload) => {
      const key = payload?.key?.trim();
      if (!key) {
        return;
      }
      setDetachedChatKeys((prev) => {
        if (!prev.has(key)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setDetachedMiddleKeys((prev) => {
        if (!prev.has(key)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // 标签拖出的文件在开窗时已从主窗口关掉；关窗时放回中栏。
      const movedFile = takeDetachedFileTab(key);
      if (movedFile) {
        requestOpenWorkspaceFile(movedFile.relPath, movedFile.root);
      }
    });
    return unsubscribe;
  }, [isPaneWindow]);

  /**
   * 以主进程的窗口清单为准校准「已拆出」。
   *
   * 关窗事件在渲染层热更新/重载时可能丢；只信事件的话主窗口会永远少一块面板。
   * 挂载时用清单**重建**一次（重载后也能恢复）；之后每次主窗口重新获得焦点
   * 只做**收窄**（删掉窗口已不存在的 key），不再把用户刚开回来的面板重新判成
   * 拆出 —— 否则顶栏开关会在点击后的第一次焦点变化时被撤销，看起来像坏了。
   */
  useEffect(() => {
    if (isPaneWindow) {
      return undefined;
    }
    const bridge = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
    if (typeof bridge?.listAuxWindows !== "function") {
      return undefined;
    }
    let cancelled = false;

    const applyKeys = (keys: readonly string[], mode: "seed" | "reconcile") => {
      const openChat = new Set<string>();
      const openMiddle = new Set<string>();
      for (const key of keys) {
        const pane = workspacePaneFromWindowKey(key);
        if (pane === "chat") {
          openChat.add(key);
        } else if (pane === "middle") {
          openMiddle.add(key);
        }
      }
      const merge = (prev: ReadonlySet<string>, open: ReadonlySet<string>) =>
        mode === "seed" ? open : new Set([...prev].filter((key) => open.has(key)));
      setDetachedChatKeys((prev) => merge(prev, openChat));
      setDetachedMiddleKeys((prev) => merge(prev, openMiddle));
    };

    const read = async (mode: "seed" | "reconcile") => {
      try {
        const result = await bridge.listAuxWindows?.();
        if (cancelled || !result?.ok || !Array.isArray(result.keys)) {
          return;
        }
        applyKeys(result.keys, mode);
      } catch {
        /* 拿不到清单就沿用事件驱动的状态 */
      }
    };

    void read("seed");
    const onFocus = () => {
      void read("reconcile");
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [isPaneWindow]);

  /** 独立窗里发过消息后，主窗口隐藏着的对话列要重新拉一次，收回时才不是旧内容。 */
  const chatDetachSeenRef = useRef(false);
  useEffect(() => {
    if (detachedChatKeys.size > 0) {
      chatDetachSeenRef.current = true;
      return;
    }
    if (!chatDetachSeenRef.current || loading) {
      return;
    }
    chatDetachSeenRef.current = false;
    void reloadActiveChatSession();
    // 独立窗里可能还有回合在跑：收回后由主窗口接上 live trace，直到最终答案落盘。
    resumeLiveChat?.();
  }, [detachedChatKeys.size, loading, reloadActiveChatSession, resumeLiveChat]);

  const paneDetach = useMemo(
    () =>
      isPaneWindow
        ? null
        : {
            chatDetached: detachedChatKeys.size > 0,
            middleDetached: detachedMiddleKeys.size > 0,
            onChatPaneDetached: handleChatPaneDetached,
            onMiddlePaneDetached: handleMiddlePaneDetached,
          },
    [
      detachedChatKeys.size,
      detachedMiddleKeys.size,
      handleChatPaneDetached,
      handleMiddlePaneDetached,
      isPaneWindow,
    ],
  );

  /** 用户主动在顶栏把面板开回来时，解除「已拆出」；否则开关会看起来没反应。 */
  const setWsShowChatRespectingDetach = useCallback(
    (value: SetStateAction<boolean>) => {
      setDetachedChatKeys((prev) => (prev.size > 0 ? new Set() : prev));
      setWsShowChat(value);
    },
    [],
  );
  const setWsShowEditorRespectingDetach = useCallback(
    (value: SetStateAction<boolean>) => {
      setDetachedMiddleKeys((prev) => (prev.size > 0 ? new Set() : prev));
      setWsShowEditor(value);
    },
    [],
  );

  return {
    windowTitle: paneMode ? workspacePaneTitle(paneMode, paneWindow?.title) : "",
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    onSidebarResizePointerDown,
    wsShowEditor,
    wsShowChat,
    wsChatColWidth,
    onWsChatSplitResize,
    setWsShowEditor,
    setWsShowChat,
    setWsShowEditorRespectingDetach,
    setWsShowChatRespectingDetach,
    paneDetach,
  };
}
