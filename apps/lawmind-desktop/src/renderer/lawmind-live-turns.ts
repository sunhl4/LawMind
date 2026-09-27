import { useSyncExternalStore } from "react";

/** One in-flight chat turn. Different sessions may run at the same time. */
export type LiveTurn = {
  assistantId: string;
  /** Session this turn started on. Undefined until the server assigns one. */
  boundSessionId: string | undefined;
  userText: string;
  abort: AbortController;
  /**
   * Lawyer left this conversation. Keep the request open (closing the stream
   * aborts the turn) but stop writing into the visible transcript.
   */
  uiDetached: boolean;
  /** Next delta should land on the latest assistant bubble after a session reload. */
  rebind: boolean;
};

export type FocusedChat = {
  assistantId: string;
  sessionId: string | undefined;
};

export function sessionQueueKey(sessionId: string | undefined, assistantId: string): string {
  const id = sessionId?.trim();
  return id ? id : `pending:${assistantId}`;
}

/** The composer input belongs to this turn only while that conversation is on screen. */
export function turnStillOwnsComposer(
  turn: { assistantId: string; boundSessionId: string | undefined },
  focus: FocusedChat,
): boolean {
  return focus.assistantId === turn.assistantId && focus.sessionId === turn.boundSessionId;
}

export function shouldDetachLiveTurn(turn: LiveTurn, focus: FocusedChat): boolean {
  if (turn.assistantId !== focus.assistantId) {
    return true;
  }
  if (turn.boundSessionId == null) {
    return focus.sessionId != null;
  }
  return turn.boundSessionId !== focus.sessionId;
}

/** Composer stop / follow-up queue applies only to the conversation on screen. */
export function focusedSessionHasLiveTurn(
  turns: Iterable<LiveTurn>,
  focus: FocusedChat,
): boolean {
  for (const turn of turns) {
    if (turn.assistantId !== focus.assistantId) {
      continue;
    }
    if (focus.sessionId) {
      if (turn.boundSessionId === focus.sessionId) {
        return true;
      }
      continue;
    }
    if (turn.boundSessionId == null && !turn.uiDetached) {
      return true;
    }
  }
  return false;
}

/** Resume painting a background turn onto the conversation now on screen. */
export function reattachLiveTurn(turns: Iterable<LiveTurn>, focus: FocusedChat): boolean {
  let found = false;
  for (const turn of turns) {
    if (turn.assistantId !== focus.assistantId || turn.boundSessionId !== focus.sessionId) {
      continue;
    }
    turn.uiDetached = false;
    turn.rebind = true;
    found = true;
  }
  return found;
}

export function clientHasLiveTurn(turns: Iterable<LiveTurn>, sessionId: string): boolean {
  for (const turn of turns) {
    if (turn.boundSessionId === sessionId) {
      return true;
    }
  }
  return false;
}

export function runningSessionIds(turns: Iterable<LiveTurn>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    const id = turn.boundSessionId?.trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

type Listener = () => void;

let runningIds: ReadonlySet<string> = new Set();
const listeners = new Set<Listener>();

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

export function setRunningChatSessionIds(ids: ReadonlySet<string>): void {
  if (setsEqual(runningIds, ids)) {
    return;
  }
  runningIds = ids;
  for (const listener of listeners) {
    listener();
  }
}

export function getRunningChatSessionIds(): ReadonlySet<string> {
  return runningIds;
}

export function subscribeRunningChatSessionIds(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRunningChatSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeRunningChatSessionIds,
    getRunningChatSessionIds,
    getRunningChatSessionIds,
  );
}
