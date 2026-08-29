/**
 * Lexical search over LawyerWork records. Does not scan audit logs.
 */

import { listLawyerWorks } from "./store.js";

export type LawyerWorkSearchHit = {
  workId: string;
  title: string;
  status: string;
  snippet: string;
};

export function searchLawyerWorks(
  workspaceDir: string,
  query: string,
  opts?: { matterId?: string; limit?: number },
): LawyerWorkSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const matterId = opts?.matterId?.trim();
  const limit = opts?.limit ?? 8;
  const hits: LawyerWorkSearchHit[] = [];
  for (const work of listLawyerWorks(workspaceDir)) {
    if (matterId && work.matterId !== matterId) {
      continue;
    }
    const haystack = `${work.title} ${work.goal} ${work.status}`.toLowerCase();
    if (!haystack.includes(q)) {
      continue;
    }
    hits.push({
      workId: work.workId,
      title: work.title,
      status: work.status,
      snippet: work.title || work.goal,
    });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}
