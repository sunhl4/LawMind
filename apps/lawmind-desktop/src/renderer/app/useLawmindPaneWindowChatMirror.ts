/**
 * 独立对话窗（`#lm-popout=workspace-pane&pane=chat`）跟服务端对齐。
 *
 * 两个窗口各自持有自己的 React 状态，切出去的那一列不会自动收到另一个窗口 /
 * 后台任务写进同一会话的新消息。这里只做两件事，避免整段状态跨窗同步：
 *   1. 会话里有别的渲染层发起的回合在跑 → 复用后台轮询（1.5s）跟着 live trace；
 *   2. 空闲时比对服务端消息指纹，变了才重拉，避免每轮都替换数组把滚动拽到底。
 *
 * 主窗口不需要：它自己就是发起回合的那一侧。
 */

import { useEffect, useRef } from "react";
import { apiAuthHeaders } from "../lawmind-api-auth";
import { fetchChatLiveTurnProgress } from "../lawmind-chat-trace";

/** 空闲比对间隔：本机回环请求，1.5s 足够近实时，也不至于每帧都打服务端。 */
export const PANE_CHAT_MIRROR_POLL_MS = 1_500;

export type PaneChatMirrorWatchInput = {
  sessionId: string;
  assistantId: string;
};

/**
 * 会话消息指纹：条数 + 末条角色/长度/尾部文本。
 *
 * 只要服务端多了消息、或助手那句变长（流式写入），指纹就变；纯元数据
 * （标题、updatedAt）变化不该触发整段重拉，所以不进指纹。
 */
export function chatSessionMessageFingerprint(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return "";
  }
  const rows = messages.filter(
    (row): row is { role?: unknown; text?: unknown } =>
      Boolean(row) && typeof row === "object",
  );
  const chatRows = rows.filter((row) => row.role === "user" || row.role === "assistant");
  const last = chatRows[chatRows.length - 1];
  const text = typeof last?.text === "string" ? last.text : "";
  return `${chatRows.length}:${text.length}:${text.slice(-64)}`;
}

export type UseLawmindPaneWindowChatMirrorInput = {
  /** 只在独立对话窗打开；主窗口中栏窗 / 主窗口都关掉。 */
  enabled: boolean;
  apiBase?: string;
  assistantId: string;
  sessionId?: string;
  /** 本窗口正在跑回合并自己流式写状态时不要对齐，否则会把流式结果覆盖掉。 */
  loading: boolean;
  reloadActiveChatSession: () => Promise<void> | void;
  /** 复用 shell 的后台轮询（`watchBackgroundSessionProgress` + `resumeOnly`）。 */
  watchSessionLive: (input: PaneChatMirrorWatchInput) => Promise<void> | void;
};

export function useLawmindPaneWindowChatMirror(
  input: UseLawmindPaneWindowChatMirrorInput,
): void {
  const {
    enabled,
    apiBase,
    assistantId,
    sessionId,
    loading,
    reloadActiveChatSession,
    watchSessionLive,
  } = input;

  /** 回调每次渲染都是新身份；放进 ref，免得 effect 重跑把指纹清空。 */
  const callbacksRef = useRef({ reloadActiveChatSession, watchSessionLive });
  callbacksRef.current = { reloadActiveChatSession, watchSessionLive };

  /** 已跟上的回合（`assistantId:sessionId`），避免每轮都重启后台轮询。 */
  const followingRef = useRef("");
  /** 上一次见到的服务端消息指纹；null = 还没读过，首轮只记录不重拉。 */
  const fingerprintRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const target = sessionId?.trim() ?? "";
    if (!enabled || !apiBase?.trim() || !target || !assistantId.trim()) {
      return undefined;
    }
    const base = apiBase.trim();
    const assistant = assistantId.trim();
    const followKey = `${assistant}:${target}`;
    followingRef.current = "";
    fingerprintRef.current = null;
    let cancelled = false;

    const readIdleFingerprint = async (): Promise<void> => {
      const res = await fetch(
        `${base}/api/sessions/${encodeURIComponent(target)}?assistantId=${encodeURIComponent(assistant)}`,
        { headers: { ...apiAuthHeaders() } },
      );
      if (!res.ok) {
        return;
      }
      const json = (await res.json()) as { ok?: boolean; messages?: unknown };
      if (cancelled || !json?.ok) {
        return;
      }
      const fingerprint = chatSessionMessageFingerprint(json.messages);
      if (!fingerprint) {
        return;
      }
      const previous = fingerprintRef.current;
      fingerprintRef.current = fingerprint;
      if (previous === null || previous === fingerprint) {
        return;
      }
      await callbacksRef.current.reloadActiveChatSession();
    };

    const tick = async (): Promise<void> => {
      if (cancelled || inFlightRef.current) {
        return;
      }
      // 看不见的窗口不拉；切回前台时下一轮会补上。
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      inFlightRef.current = true;
      try {
        // 本窗口正在流式输出：等它自己收尾，别用服务端快照覆盖。
        if (loading) {
          return;
        }
        const live = await fetchChatLiveTurnProgress(base, target);
        if (cancelled) {
          return;
        }
        if (live.progress?.status === "running") {
          if (followingRef.current === followKey) {
            return;
          }
          followingRef.current = followKey;
          await callbacksRef.current.watchSessionLive({
            sessionId: target,
            assistantId: assistant,
          });
          return;
        }
        followingRef.current = "";
        await readIdleFingerprint();
      } catch {
        /* 瞬时失败留给下一轮；不要把独立窗顶到错误态 */
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, PANE_CHAT_MIRROR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assistantId, apiBase, enabled, loading, sessionId]);
}
