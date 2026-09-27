/**
 * Shared parent-context budget for parallel child injections
 * (delegations and draft sidecars). Each child keeps its own transcript;
 * only a slice of the same pool is admitted into the parent turn.
 */

export const ISOLATION_PARENT_BUDGET_CHARS = 3_200;

const usedByKey = new Map<string, number>();

export function isolationKey(workspaceDir: string, sessionId: string): string {
  return `${workspaceDir}\0${sessionId}`;
}

export function resetIsolationBudget(key: string): void {
  usedByKey.delete(key);
}

/** Synchronous so parallel completions cannot overspend between awaits. */
export function takeIsolationBudget(key: string, want: number): number {
  const ask = Math.max(0, Math.floor(want));
  const used = usedByKey.get(key) ?? 0;
  const granted = Math.min(ask, Math.max(0, ISOLATION_PARENT_BUDGET_CHARS - used));
  usedByKey.set(key, used + granted);
  return granted;
}

export function isolationBudgetUsed(key: string): number {
  return usedByKey.get(key) ?? 0;
}
