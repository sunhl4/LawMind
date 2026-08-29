/**
 * Cooperative abort for in-flight chat turns (Stop button / pause output).
 * - Flag checked between model rounds in `runTurn`
 * - Per-session AbortSignal cancels in-flight HTTP model fetch/stream when Stop is pressed
 */

const abortRequested = new Set<string>();
const abortControllers = new Map<string, AbortController>();

function normalizeSessionId(sessionId: string | undefined): string {
  return sessionId?.trim() ?? "";
}

/**
 * Bind a fresh AbortSignal for this turn. Call at turn start (after clearTurnAbort).
 */
export function bindTurnAbortSignal(sessionId: string): AbortSignal {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return new AbortController().signal;
  }
  abortRequested.delete(id);
  const controller = new AbortController();
  abortControllers.set(id, controller);
  return controller.signal;
}

export function getTurnAbortSignal(sessionId: string | undefined): AbortSignal | undefined {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return undefined;
  }
  return abortControllers.get(id)?.signal;
}

export function requestTurnAbort(sessionId: string): void {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return;
  }
  abortRequested.add(id);
  abortControllers.get(id)?.abort();
}

export function clearTurnAbort(sessionId: string): void {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return;
  }
  abortRequested.delete(id);
  abortControllers.delete(id);
}

export function isTurnAbortRequested(sessionId: string | undefined): boolean {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return false;
  }
  return abortRequested.has(id);
}

/** Test helper */
export function resetTurnAbortStore(): void {
  abortRequested.clear();
  abortControllers.clear();
}
