/**
 * Validates a single path segment used as task id in /api/tasks/:id and /api/drafts/:id.
 */
export function isSafeTaskIdSegment(id: string): boolean {
  if (!id || id.length > 200) {
    return false;
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(id);
}
