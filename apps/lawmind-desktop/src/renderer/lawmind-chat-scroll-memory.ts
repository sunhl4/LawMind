/**
 * 每个对话的阅读位置。
 *
 * 切走对话时记住「距底部多少像素」，切回来时原样恢复：贴在最新一条就回到最新
 * 一条，正在上翻读 §3 就停在 §3。用距底部而不是绝对 scrollTop —— 虚拟列表
 * 重新量高时绝对位置会漂，距底部对「最后一条消息」才是稳定锚点。
 *
 * 只存在渲染进程内存里：主窗口和独立对话窗各自一份，互不影响；应用重启后
 * 回到默认（最新一条）即可。
 */

import { chatMessagesScrollContainers } from "./lawmind-chat-scroll";

/** 距底部小于这个值就视为「贴在最新一条」；再增长时继续跟随。 */
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 48;

export type ChatScrollMemory = {
  /** 距底部的像素；0 = 最新一条。 */
  fromBottom: number;
};

const positions = new Map<string, ChatScrollMemory>();

export function rememberChatScrollPosition(sessionId: string, fromBottom: number): void {
  const id = sessionId.trim();
  if (!id || !Number.isFinite(fromBottom)) {
    return;
  }
  positions.set(id, { fromBottom: Math.max(0, fromBottom) });
}

export function readChatScrollPosition(sessionId: string): ChatScrollMemory | null {
  const id = sessionId.trim();
  return id ? (positions.get(id) ?? null) : null;
}

/** 单测用：清空跨用例的模块状态。 */
export function clearChatScrollPositions(): void {
  positions.clear();
}

/** 当前 transcript 距底部的像素；面板还没挂载时返回 null。 */
export function measureChatScrollFromBottom(): number | null {
  const containers = chatMessagesScrollContainers();
  if (containers.length === 0) {
    return null;
  }
  // 嵌套虚拟列表才是真正的滚动容器；面板本身可滚时再退回面板。
  const primary =
    containers.find((el) => el.scrollHeight - el.clientHeight > 1) ?? containers[0];
  return Math.max(0, primary.scrollHeight - primary.clientHeight - primary.scrollTop);
}

export function isChatScrolledToBottom(fromBottom: number): boolean {
  return fromBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
}
