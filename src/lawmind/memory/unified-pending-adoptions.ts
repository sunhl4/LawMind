/**
 * Unified pending memory adoptions.
 *
 * Read truth = memory-adoption service. learning/suggestion-queue is a write-compat
 * path that mirrors into adoption; this helper merges any learning rows that were
 * not mirrored (legacy / race) and dedupes by sourceTaskId.
 */

import { listLearningSuggestions } from "../learning/suggestion-queue.js";
import { listPendingMemorySuggestions, type MemoryAdoptionRecord } from "./adoption-service.js";

export type UnifiedPendingAdoption = MemoryAdoptionRecord & {
  /** Present when the row originated only from learning queue (not yet mirrored). */
  learningSuggestionId?: string;
};

export async function listPendingAdoptionsUnified(
  workspaceDir: string,
): Promise<UnifiedPendingAdoption[]> {
  const adoptionPending = await listPendingMemorySuggestions(workspaceDir);
  const learningPending = await listLearningSuggestions(workspaceDir, "pending");

  const seenTaskIds = new Set<string>();
  const out: UnifiedPendingAdoption[] = [];

  for (const row of adoptionPending) {
    if (row.sourceTaskId) {
      seenTaskIds.add(row.sourceTaskId);
    }
    out.push(row);
  }

  for (const learn of learningPending) {
    if (seenTaskIds.has(learn.taskId)) {
      continue;
    }
    seenTaskIds.add(learn.taskId);
    out.push({
      id: `learning:${learn.id}`,
      createdAt: learn.createdAt,
      state: "pending",
      scope: "lawyer",
      kind: "review_label",
      targetId: learn.matterId,
      payload: JSON.stringify({
        labels: learn.labels,
        note: learn.note ?? null,
        learningSuggestionId: learn.id,
      }),
      sourceTaskId: learn.taskId,
      origin: "lawyer",
      note: learn.note,
      learningSuggestionId: learn.id,
    });
  }

  return out.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}
