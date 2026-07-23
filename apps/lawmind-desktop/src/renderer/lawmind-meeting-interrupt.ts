/** Detect cooperative abort replies from `/api/chat` after session abort. */
export function isAbortedMeetingReply(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  return t === "已停止生成。" || t === "已停止生成";
}

/** Max wait for queue/conclude to settle after lawyer interrupt (ms). */
export const MEETING_INTERRUPT_WAIT_MS = 12_000;

/** After a model/API failure mid-queue: pause (not stuck running) so lawyer can exit. */
export function deliberationStateAfterModelError(): {
  phase: "paused";
  busy: false;
  statusLabel: string;
} {
  return {
    phase: "paused",
    busy: false,
    statusLabel: "出错已暂停。可重试继续或结束。",
  };
}
