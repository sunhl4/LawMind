/**
 * 「拖出到独立窗口」的渲染端入口。
 *
 * 主窗口与独立窗口是同一套渲染代码；独立窗口只挂指定 pane（见 `main.tsx`）。
 * 这里保持纯函数 + 一个薄桥接，方便单测与无 Electron 环境报错。
 */

import type {
  LawmindWorkspacePane,
  LawmindWorkspacePaneRoute,
} from "./lawmind-popout-route";

export const PANE_DETACH_DRAG_THRESHOLD_PX = 48;

export type PaneWindowOpenResult = {
  ok: boolean;
  key?: string;
  focused?: boolean;
  error?: string;
  /** true = 走 Electron 主进程开窗；false = 当前环境不支持。 */
  bridged: boolean;
};

/** 主窗口把 pane 的「已拆出」状态和恢复回调交给工作区面板。 */
export type LawmindPaneDetachBridge = {
  chatDetached: boolean;
  middleDetached: boolean;
  onChatPaneDetached: (key: string) => void;
  onMiddlePaneDetached: (key: string) => void;
};

export function workspacePaneTitle(
  pane: LawmindWorkspacePane,
  explicit?: string | null,
): string {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  return pane === "chat" ? "对话" : "中栏";
}

/**
 * 同一 pane + 同一上下文只开一个窗口；主进程与渲染端必须用同一把 key。
 * 对话按会话区分；中栏按草稿 > 文件 > 案件区分 —— 文件比案件更具体，
 * 否则同一案件下拖出两份不同文件会命中同一把 key、只聚焦回旧窗口。
 * 允许并排开多个不同内容的中栏窗。
 */
export function workspacePaneWindowKey(
  route: Pick<
    LawmindWorkspacePaneRoute,
    "pane" | "sessionId" | "matterId" | "draftTaskId" | "relPath" | "root"
  >,
): string {
  const relPath = route.relPath?.trim();
  const fileContext = relPath
    ? `${route.root?.trim() || "workspace"}:${relPath}`
    : "";
  const context =
    route.pane === "chat"
      ? route.sessionId?.trim() || "current"
      : route.draftTaskId?.trim() || fileContext || route.matterId?.trim() || "current";
  return `workspace-pane:${route.pane}:${context}`;
}

/** 指针移动超过阈值才视为「拖出」，轻点仍然按按钮处理。 */
export function paneDetachDragExceeded(
  start: { x: number; y: number },
  end: { x: number; y: number },
  threshold = PANE_DETACH_DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold;
}

/**
 * 主进程登记用的窗口 key → 它占的是哪一块 pane。
 *
 * `workspace-pane:chat:<上下文>` / `workspace-pane:middle:<上下文>`；交付预览等其它
 * key 与主窗口版面无关，返回 null。
 */
export function workspacePaneFromWindowKey(key: string): LawmindWorkspacePane | null {
  const trimmed = key.trim();
  if (trimmed.startsWith("workspace-pane:chat:")) {
    return "chat";
  }
  if (trimmed.startsWith("workspace-pane:middle:")) {
    return "middle";
  }
  return null;
}

export async function openWorkspacePaneWindow(
  route: LawmindWorkspacePaneRoute,
): Promise<PaneWindowOpenResult> {
  const bridge = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  if (typeof bridge?.openAuxWindow !== "function") {
    return {
      ok: false,
      bridged: false,
      error: "当前环境不能打开独立窗口，请使用 LawMind 桌面版。",
    };
  }
  try {
    const result = await bridge.openAuxWindow(route);
    return {
      ok:  result?.ok,
      key: result?.key,
      focused: result?.focused === true,
      error: result?.error,
      bridged: true,
    };
  } catch (error) {
    return {
      ok: false,
      bridged: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 独立窗里的「收回主窗口」。
 *
 * 渲染层直接 `window.close()` 在 Electron 里不保证真的关窗（脚本没开过的窗口会被
 * Chromium 拦掉），所以有 preload 桥时交给主进程 `BrowserWindow.close()`；
 * 没桥（浏览器标签 / 单测）才退回 `window.close()`。
 *
 * 返回 false = 两条路都没能把窗口关掉（典型：主进程还是旧版本、没有
 * `lawmind:close-window` 处理器，而 `window.close()` 又被拦）。调用方据此提示，
 * 不要让按钮看起来像坏了。
 */
export async function closeWorkspacePaneWindow(): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  if (typeof bridge?.closeWindow === "function") {
    try {
      const result = await bridge.closeWindow();
      if (result?.ok) {
        return true;
      }
    } catch {
      /* 主进程拒绝（窗口已销毁等）时再退回 window.close() */
    }
  }
  try {
    window.close();
  } catch {
    /* jsdom / 非窗口环境 */
  }
  // 给 Chromium 一个任务边界真正处理 close；窗口已销毁时这里不会再执行。
  await new Promise<void>((resolve) => {
    try {
      window.setTimeout(resolve, 0);
    } catch {
      resolve();
    }
  });
  try {
    return  window.closed;
  } catch {
    return true;
  }
}
