/**
 * 任务 ID 在律师可读文案中的展示（完整 ID 仍存于任务 JSON / 审计）。
 */
export function shortTaskIdForDisplay(taskId: string): string {
  const t = taskId.trim();
  if (!t) {
    return "—";
  }
  const first = t.split("-")[0] ?? t;
  if (/^[a-f0-9]{8}$/i.test(first)) {
    return first;
  }
  if (t.length <= 10) {
    return t;
  }
  return `${t.slice(0, 8)}…`;
}

/** 进展类一句话前缀，避免「任务 uuid-uuid-…」占满行首 */
export function taskProgressPrefix(taskId: string): string {
  return `「${shortTaskIdForDisplay(taskId)}」`;
}
