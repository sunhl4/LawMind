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
 * Bind a fresh AbortSignal for this turn.
 * A Stop that arrived during setup (MCP / 材料预读 / 提示组装) is kept:
 * the new signal starts already aborted, and the request flag stays set.
 */
export function bindTurnAbortSignal(sessionId: string): AbortSignal {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return new AbortController().signal;
  }
  const pending = abortRequested.has(id);
  const controller = new AbortController();
  abortControllers.set(id, controller);
  if (pending) {
    controller.abort();
  }
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
