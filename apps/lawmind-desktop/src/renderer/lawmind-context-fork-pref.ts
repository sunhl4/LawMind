/**
 * 「上下文过多 → 建议另起新对话」的一次性提示状态。
 *
 * 按仓库口径（对话线程不堆过程芯片 / 拍板卡），同一会话只提示一次：律师点过
 * 「继续本对话」就记住，别再打扰。按 sessionId 存，换会话重新判断。
 */

const FORK_SUGGEST_DISMISSED_KEY = "lawmind.ui.forkSuggestDismissed.v1";

type DismissedMap = Record<string, string>;

function readMap(): DismissedMap {
  try {
    const raw = localStorage.getItem(FORK_SUGGEST_DISMISSED_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as DismissedMap;
  } catch {
    return {};
  }
}

export function readForkSuggestDismissedAt(sessionId: string | undefined): string | undefined {
  const id = sessionId?.trim();
  if (!id) {
    return undefined;
  }
  return readMap()[id];
}

export function isForkSuggestionDismissed(sessionId: string | undefined): boolean {
  return Boolean(readForkSuggestDismissedAt(sessionId));
}

export function dismissForkSuggestion(sessionId: string | undefined, at?: string): void {
  const id = sessionId?.trim();
  if (!id) {
    return;
  }
  try {
    const map = readMap();
    map[id] = at ?? new Date().toISOString();
    // 只保留最近 200 条，避免 localStorage 无界增长。
    const entries = Object.entries(map).slice(-200);
    localStorage.setItem(FORK_SUGGEST_DISMISSED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 记不住也不阻塞律师：最多下次再提示一次 */
  }
}
