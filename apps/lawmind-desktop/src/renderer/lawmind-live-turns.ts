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
  /** `queued` means this chat is waiting for a model slot, not generating. */
  phase?: "running" | "queued";
};

export type FocusedChat = {
  assistantId: string;
  sessionId: string | undefined;
};

/** Queue and focus follow the conversation. Assistant id is not a second key. */
export function sessionQueueKey(sessionId: string | undefined, _assistantId?: string): string {
  const id = sessionId?.trim();
  return id ? id : "pending";
}

/** The composer input belongs to this turn only while that conversation is on screen. */
export function turnStillOwnsComposer(
  turn: { boundSessionId: string | undefined },
  focus: { sessionId: string | undefined },
): boolean {
  return focus.sessionId === turn.boundSessionId;
}

export function shouldDetachLiveTurn(turn: LiveTurn, focus: FocusedChat): boolean {
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
    if (turn.boundSessionId !== focus.sessionId) {
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

export function partitionLiveSessions(turns: Iterable<LiveTurn>): {
  running: ReadonlySet<string>;
  queued: ReadonlySet<string>;
} {
  const running = new Set<string>();
  const queued = new Set<string>();
  for (const turn of turns) {
    const id = turn.boundSessionId?.trim();
    if (!id) {
      continue;
    }
    if (turn.phase === "queued") {
      queued.add(id);
    } else {
      running.add(id);
    }
  }
  return { running, queued };
}

export function runningSessionIds(turns: Iterable<LiveTurn>): ReadonlySet<string> {
  return partitionLiveSessions(turns).running;
}

export function queuedSessionIds(turns: Iterable<LiveTurn>): ReadonlySet<string> {
  return partitionLiveSessions(turns).queued;
}

type Listener = () => void;

type LiveChatActivity = {
  running: ReadonlySet<string>;
  queued: ReadonlySet<string>;
};

let activity: LiveChatActivity = { running: new Set(), queued: new Set() };
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

export function setLiveChatActivity(next: LiveChatActivity): void {
  if (setsEqual(activity.running, next.running) && setsEqual(activity.queued, next.queued)) {
    return;
  }
  activity = {
    running: next.running,
    queued: next.queued,
  };
  for (const listener of listeners) {
    listener();
  }
}

export function setRunningChatSessionIds(ids: ReadonlySet<string>): void {
  setLiveChatActivity({ running: ids, queued: new Set() });
}

export function getRunningChatSessionIds(): ReadonlySet<string> {
  return activity.running;
}

export function getQueuedChatSessionIds(): ReadonlySet<string> {
  return activity.queued;
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

export function useQueuedChatSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeRunningChatSessionIds,
    getQueuedChatSessionIds,
    getQueuedChatSessionIds,
  );
}
