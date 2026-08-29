/**
 * Fail-closed session disk writes. A persist miss must stop the turn so
 * memory history cannot diverge from session.json / events.jsonl / turns.jsonl.
 */

export class SessionPersistError extends Error {
  readonly code = "SESSION_PERSIST_FAILED";
  readonly op: string;

  constructor(op: string, cause?: unknown) {
    super(`会话无法写入磁盘（${op}），本轮已停止，以免内存与落盘分裂。`);
    this.name = "SessionPersistError";
    this.op = op;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function isSessionPersistError(err: unknown): err is SessionPersistError {
  return err instanceof SessionPersistError;
}

export function persistOrThrow(op: string, write: () => void): void {
  try {
    write();
  } catch (cause) {
    throw new SessionPersistError(op, cause);
  }
}
