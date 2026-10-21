import { fetchChatSessionSnapshot } from "./lawmind-chat-message-mutate";
import type { ChatMsg } from "./lawmind-chat";

export type ChatReconcileOutcome = "settled" | "paused" | "interrupted" | "unknown";

/** Only persisted state for this exact turn can settle an uncertain stream. Never resend. */
export async function reconcileChatTurn(opts: {
  apiBase: string;
  sessionId: string;
  turnId?: string;
  assistantId: string;
  signal: AbortSignal;
  onMessages: (messages: ChatMsg[]) => void;
  intervalMs?: number;
  maxPolls?: number;
  requestTimeoutMs?: number;
}): Promise<ChatReconcileOutcome> {
  if (!opts.turnId) { return "unknown"; }
  const maxPolls = opts.maxPolls ?? 60;
  for (let i = 0; i < maxPolls; i += 1) {
    opts.signal.throwIfAborted();
    try {
      const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.requestTimeoutMs ?? 5000)]);
      const snapshot = await fetchChatSessionSnapshot(opts.apiBase, opts.sessionId, opts.assistantId, signal);
      opts.signal.throwIfAborted();
      const turn = snapshot.latestTurn;
      if (turn?.turnId === opts.turnId) {
        let outcome: ChatReconcileOutcome = "unknown";
        if (turn.interrupted) { outcome = "interrupted"; }
        else if (["awaiting_approval", "awaiting_clarification", "paused"].includes(turn.status)) { outcome = "paused"; }
        else if (["completed", "error"].includes(turn.status) && turn.completedAt) { outcome = "settled"; }
        if (outcome !== "unknown") {
          opts.onMessages(snapshot.messages);
          return outcome;
        }
      }
    } catch (err) {
      if (opts.signal.aborted) { throw err; }
    }
    if (i + 1 < maxPolls) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); opts.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, opts.intervalMs ?? 1000);
        opts.signal.addEventListener("abort", done, { once: true });
        if (opts.signal.aborted) { done(); }
      });
    }
  }
  return "unknown";
}
