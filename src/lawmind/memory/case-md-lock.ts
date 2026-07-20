/**
 * Serialize CASE.md read-modify-write per matter.
 * Concurrent appends/projections otherwise lose updates (empty §9, torn templates).
 */

const tails = new Map<string, Promise<unknown>>();

function lockKey(workspaceDir: string, matterId: string): string {
  return `${workspaceDir}\0${matterId}`;
}

export async function withCaseMdLock<T>(
  workspaceDir: string,
  matterId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(workspaceDir, matterId);
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
