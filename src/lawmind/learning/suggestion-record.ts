/**
 * Learning suggestion row shape — renderer-safe (no node:fs / node:crypto).
 * Queue persistence stays in suggestion-queue.ts (server/engine only).
 */

import type { ReviewLabel, ReviewStatus } from "../types.js";

export type LearningSuggestionState = "pending" | "adopted" | "dismissed";

export type LearningSuggestionRecord = {
  id: string;
  createdAt: string;
  state: LearningSuggestionState;
  taskId: string;
  matterId?: string;
  /** 审核时选择的 status */
  reviewStatus: Exclude<ReviewStatus, "pending">;
  note?: string;
  labels: ReviewLabel[];
  assistantId?: string;
  adoptedAt?: string;
};
