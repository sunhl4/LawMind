/**
 * 回合内整理、检索收短是助手自己的上下文，不进对话框。
 * 律师看不懂这些条，也容易当成这场对话还没开始就已经有很多上文。
 * 整理仍在后台进行；用量环和另起新对话的结果不受这里影响。
 */
const ASSISTANT_MEMORY_STATUS_PREFIXES = [
  "较早的来回已收成要点",
  "较早的检索结果已收短",
  "这场对话已整理",
] as const;

export function isAssistantMemoryStatusLabel(label: string): boolean {
  const text = label.trim();
  return ASSISTANT_MEMORY_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix));
}
