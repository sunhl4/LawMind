/**
 * 对话阅读位置的记忆与恢复（Cursor-like：切回一场对话时停在离开时的位置）。
 *
 * 三条规则：
 *  1. 切走时记住「距底部多少像素」，切回来先恢复它；没有记录才落到底部。
 *  2. 恢复/跟随全部用瞬时滚动，不再 smooth —— 切会话时不会出现长距离滑动。
 *  3. 只有本来就贴在底部时才继续跟随新消息；律师上翻读前文时不抢滚动条。
 *
 * 恢复窗口（1.5s）内 transcript 每次变化都会重新恢复：切会话时消息是异步换入的，
 * 第一次恢复可能还作用在旧内容上。虚拟列表重新量高也在窗口内被纠正。
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { pinChatMessagesToLatest } from "./lawmind-chat-scroll";
import {
  isChatScrolledToBottom,
  measureChatScrollFromBottom,
  readChatScrollPosition,
  rememberChatScrollPosition,
} from "./lawmind-chat-scroll-memory";

const RESTORE_WINDOW_MS = 1_500;

export type UseChatSessionScrollMemoryInput = {
  sessionId?: string | null;
  /** 消息指纹（条数 + 末条长度 + loading）；变化即认为 transcript 有更新。 */
  transcriptKey: string;
};

export function useChatSessionScrollMemory(input: UseChatSessionScrollMemoryInput): void {
  const { sessionId, transcriptKey } = input;
  const sessionRef = useRef("");
  const pinnedRef = useRef(true);
  const cancelPinRef = useRef<(() => void) | null>(null);
  const restoreUntilRef = useRef(0);

  const saveNow = useCallback(() => {
    const id = sessionRef.current.trim();
    if (!id) {
      return;
    }
    const fromBottom = measureChatScrollFromBottom();
    if (fromBottom == null) {
      return;
    }
    rememberChatScrollPosition(id, fromBottom);
    pinnedRef.current = isChatScrolledToBottom(fromBottom);
  }, []);

  const restoreNow = useCallback((id: string) => {
    if (!id) {
      return;
    }
    const saved = readChatScrollPosition(id);
    const fromBottom = saved?.fromBottom ?? 0;
    pinnedRef.current = isChatScrolledToBottom(fromBottom);
    cancelPinRef.current?.();
    cancelPinRef.current = pinChatMessagesToLatest({ fromBottom });
  }, []);

  // 会话切换：瞬时恢复这一场的位置。
  //
  // 不在切换时补存上一场：这次 render 可能已经带着新会话的消息提交了，量到的
  // scrollTop 属于新内容，会把上一场的记忆写坏。位置由滚动监听持续保存，
  // 页面卸载时再兜底存一次。
  useLayoutEffect(() => {
    const next = sessionId?.trim() ?? "";
    sessionRef.current = next;
    if (!next) {
      // 还没有会话（空对话 / 单测里的无 session 渲染）：沿用旧行为贴到最新。
      cancelPinRef.current?.();
      cancelPinRef.current = pinChatMessagesToLatest();
      return;
    }
    restoreUntilRef.current = Date.now() + RESTORE_WINDOW_MS;
    restoreNow(next);
  }, [sessionId, restoreNow]);

  // transcript 更新：恢复窗口内持续纠正；窗口外只在本就贴底时继续贴底（瞬时）。
  useLayoutEffect(() => {
    const id = sessionRef.current.trim();
    if (!id) {
      return;
    }
    if (Date.now() < restoreUntilRef.current) {
      restoreNow(id);
      return;
    }
    if (pinnedRef.current) {
      cancelPinRef.current?.();
      cancelPinRef.current = pinChatMessagesToLatest();
    }
  }, [transcriptKey, restoreNow]);

  // 滚动监听：同步测量并记录位置 + 是否贴底。
  // scroll 不冒泡，但 capture 能收到嵌套虚拟列表的滚动；同步测量避免「切会话的
  // 同一帧里，延迟到 rAF 的回调量到新内容、把位置记到错误会话上」。
  useEffect(() => {
    const panel = document.getElementById("lawmind-chat-messages-panel");
    if (!panel) {
      return undefined;
    }
    const onScroll = () => {
      saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
      }
    };
    panel.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      panel.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveNow]);

  // 切到在办/文书台会卸载这一列：layout cleanup 在 DOM 移除前把位置存下来。
  useLayoutEffect(() => {
    return () => {
      cancelPinRef.current?.();
      saveNow();
    };
  }, [saveNow]);
}
