/**
 * 审核标签只产生待确认记忆。黄金样本仍是律师勾了「质量范例」之后的显式晋升。
 */

import { emit } from "../audit/index.js";
import { promoteGoldenExample } from "../evaluation/golden.js";
import { commitMemory } from "../memory/kernel/gateway.js";
import type { ArtifactDraft, ReviewLabel, ReviewStatus } from "../types.js";

export type ApplyReviewLabelsParams = {
  status: Exclude<ReviewStatus, "pending">;
  note?: string;
  labels: ReviewLabel[];
  assistantId?: string;
};

/**
 * 执行标签对应的记忆写回与黄金样本晋升（不含 draft.review_labeled 审计）。
 */
export async function applyReviewLabelsMemoryWrites(
  workspaceDir: string,
  auditDir: string,
  draft: ArtifactDraft,
  params: ApplyReviewLabelsParams & { confirmNow?: boolean },
): Promise<void> {
  const { status, note, labels } = params;
  if (labels.length === 0) {
    return;
  }

  const noteParts = [note?.trim(), labels.length > 0 ? `labels:${labels.join(",")}` : ""].filter(
    Boolean,
  );
  const learningNote = noteParts.length > 0 ? noteParts.join(" ") : undefined;
  const learningLine = learningNote
    ? `草稿审核（任务 ${draft.taskId}，${status}）：${learningNote}`
    : `草稿审核（任务 ${draft.taskId}，${status}）。`;
  const saved = commitMemory(workspaceDir, {
    kind: "habit",
    scope: "lawyer",
    key: "habit.review",
    body: learningLine,
    origin: "review",
    sourceTaskId: draft.taskId,
    ...(draft.matterId ? { sourceMatterId: draft.matterId } : {}),
    confirmNow: params.confirmNow === true,
  });
  if (params.confirmNow === true) {
    const { appendLawyerProfileLearning } = await import("../memory/lawyer-profile-learning.js");
    await appendLawyerProfileLearning(workspaceDir, saved.body, "review", {
      auditDir,
      auditTaskId: draft.taskId,
    }).catch(() => undefined);
  }

  if (labels.includes("质量范例")) {
    try {
      const promoted = await promoteGoldenExample(workspaceDir, draft.taskId);
      if (promoted?.created) {
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "golden.example_promoted",
          actor: "lawyer",
          actorId: draft.reviewedBy ?? "lawyer",
          detail: `golden/${draft.taskId}.golden.json`,
        });
      }
    } catch {
      /* ignore */
    }
  }
}
