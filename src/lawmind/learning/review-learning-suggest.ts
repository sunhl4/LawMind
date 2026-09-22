/**
 * Wave A / T2：草稿「需修改」→ pending memory adoption（律师确认后才写正式 profile）。
 */

import { buildReviewProfileLine } from "../assistants/profile-md.js";
import {
  listMemorySuggestions,
  suggestMemoryAdoption,
  type MemoryAdoptionRecord,
} from "../memory/adoption-service.js";
import { buildLawyerProfileReviewLearningLine } from "../memory/lawyer-profile-learning.js";
import type { ReviewLabel, ReviewStatus } from "../types.js";

const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SUGGESTIONS_PER_TASK = 3;
const MAX_PAYLOAD_CHARS = 200;

export function normalizeAdoptionPayload(payload: string): string {
  return payload.replace(/\s+/g, " ").trim().toLowerCase();
}

export function splitLearningBullets(note: string, max = MAX_SUGGESTIONS_PER_TASK): string[] {
  const trimmed = note.trim();
  if (!trimmed) {
    return [];
  }
  const parts = trimmed
    .split(/\n+|；|(?<=[。！？])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length === 0) {
    return [trimmed.slice(0, MAX_PAYLOAD_CHARS)];
  }
  return parts.slice(0, max).map((s) => s.slice(0, MAX_PAYLOAD_CHARS));
}

/** Dedupe on rule text within the same scope+kind (7 days). */
export function isRecentDuplicateAdoption(
  rows: MemoryAdoptionRecord[],
  ruleText: string,
  match: { scope: MemoryAdoptionRecord["scope"]; kind: MemoryAdoptionRecord["kind"] },
  nowMs: number = Date.now(),
): boolean {
  const key = normalizeAdoptionPayload(ruleText);
  if (!key) {
    return true;
  }
  const cutoff = nowMs - DEDUPE_WINDOW_MS;
  return rows.some((r) => {
    if (r.scope !== match.scope || r.kind !== match.kind) {
      return false;
    }
    const t = Date.parse(r.createdAt);
    if (!Number.isFinite(t) || t < cutoff) {
      return false;
    }
    const prior = r.note?.trim() ? r.note : r.payload;
    return normalizeAdoptionPayload(prior) === key;
  });
}

export type SuggestLearningFromDraftReviewParams = {
  workspaceDir: string;
  auditDir: string;
  taskId: string;
  status: Exclude<ReviewStatus, "pending">;
  note?: string;
  labels?: ReviewLabel[];
  assistantId?: string;
  /** 标签路径已负责写回 / 入队时跳过，避免重复噪声 */
  skipBecauseLabels?: boolean;
};

/**
 * 从「需修改」审核备注生成 pending 学习建议（不自动 adopt）。
 */
export async function suggestLearningFromDraftReview(
  params: SuggestLearningFromDraftReviewParams,
): Promise<MemoryAdoptionRecord[]> {
  const { workspaceDir, auditDir, taskId, status, note, assistantId, skipBecauseLabels } = params;

  if (status !== "modified") {
    return [];
  }
  if (skipBecauseLabels) {
    return [];
  }
  const bullets = splitLearningBullets(note ?? "");
  if (bullets.length === 0) {
    return [];
  }

  const existing = await listMemorySuggestions(workspaceDir);
  const pendingFromTask = existing.filter(
    (r) => r.sourceTaskId === taskId && r.state === "pending",
  ).length;
  let budget = Math.max(0, MAX_SUGGESTIONS_PER_TASK - pendingFromTask);
  if (budget === 0) {
    return [];
  }

  const nowMs = Date.now();
  const created: MemoryAdoptionRecord[] = [];
  const targetAssistant = assistantId?.trim() || undefined;

  for (const bullet of bullets) {
    if (budget <= 0) {
      break;
    }
    if (targetAssistant && budget > 0) {
      const assistantMatch = {
        scope: "assistant" as const,
        kind: "assistant.profile_section" as const,
      };
      if (!isRecentDuplicateAdoption(existing, bullet, assistantMatch, nowMs)) {
        const payload = buildReviewProfileLine(taskId, status, bullet).slice(0, MAX_PAYLOAD_CHARS);
        const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
          scope: "assistant",
          kind: "assistant.profile_section",
          targetId: targetAssistant,
          payload,
          sourceTaskId: taskId,
          origin: "lawyer",
          note: bullet,
        });
        created.push(rec);
        existing.push(rec);
        budget -= 1;
      }
    }
    if (budget <= 0) {
      break;
    }
    const lawyerMatch = {
      scope: "lawyer" as const,
      kind: "lawyer.profile_learning" as const,
    };
    if (!isRecentDuplicateAdoption(existing, bullet, lawyerMatch, nowMs)) {
      const lawyerPayload = buildLawyerProfileReviewLearningLine(taskId, status, bullet).slice(
        0,
        MAX_PAYLOAD_CHARS,
      );
      const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
        payload: lawyerPayload,
        sourceTaskId: taskId,
        origin: "lawyer",
        note: bullet,
      });
      created.push(rec);
      existing.push(rec);
      budget -= 1;
    }
  }

  return created;
}
