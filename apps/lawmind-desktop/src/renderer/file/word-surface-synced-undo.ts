/**
 * After a lawyer edit is written to the redline proposal, Control+Z must still
 * be able to take that pending hunk back — the browser undo stack alone is gone
 * once React reloads the page paint.
 */

export type SyncedLawyerUndo = {
  taskId: string;
  hunkId: string;
  before: string;
  after: string;
};

const MAX_STACK = 40;

export function pushSyncedLawyerUndo(
  stack: SyncedLawyerUndo[],
  entry: SyncedLawyerUndo,
): SyncedLawyerUndo[] {
  const next = stack.filter((row) => row.hunkId !== entry.hunkId);
  next.push(entry);
  if (next.length > MAX_STACK) {
    next.splice(0, next.length - MAX_STACK);
  }
  return next;
}

export function popSyncedLawyerUndo(stack: SyncedLawyerUndo[]): {
  stack: SyncedLawyerUndo[];
  entry: SyncedLawyerUndo | null;
} {
  if (stack.length === 0) {
    return { stack, entry: null };
  }
  const next = stack.slice(0, -1);
  return { stack: next, entry: stack[stack.length - 1] ?? null };
}

/** Pending lawyer hunks that match the live edits just synced. */
export function matchSyncedLawyerHunks(
  hunks: Array<{ hunkId: string; before: string; after: string; status: string; author?: string }>,
  edits: Array<{ before: string; after: string }>,
): Array<{ hunkId: string; before: string; after: string }> {
  const out: Array<{ hunkId: string; before: string; after: string }> = [];
  for (const edit of edits) {
    const match = hunks.find(
      (hunk) =>
        hunk.status === "pending" &&
        hunk.before === edit.before &&
        hunk.after === edit.after,
    );
    if (match) {
      out.push({ hunkId: match.hunkId, before: match.before, after: match.after });
    }
  }
  return out;
}
