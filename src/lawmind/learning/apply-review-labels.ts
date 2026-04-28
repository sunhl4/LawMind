/**
 * 将审核结构化标签写回律师档案、助手档案、Playbook，并晋升黄金样本。
 * 与 audit 中的 draft.review_labeled 分离：先由引擎 emit 该事件，再调用本函数。
 */

import {
  appendAssistantProfileMarkdown,
  buildReviewProfileLine,
} from "../assistants/profile-md.js";
import { resolveLawMindRoot } from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { promoteGoldenExample } from "../evaluation/golden.js";
import {
  appendClausePlaybookLearning,
  buildClausePlaybookReviewLine,
  reviewLabelsTriggerPlaybook,
} from "../memory/index.js";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
} from "../memory/lawyer-profile-learning.js";
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
  params: ApplyReviewLabelsParams,
): Promise<void> {
  const { status, note, labels, assistantId } = params;
  if (labels.length === 0) {
    return;
  }

  const noteParts = [note?.trim(), labels.length > 0 ? `labels:${labels.join(",")}` : ""].filter(
    Boolean,
  );
  const learningNote = noteParts.length > 0 ? noteParts.join(" ") : undefined;
  const learningLine = buildLawyerProfileReviewLearningLine(draft.taskId, status, learningNote);
  await appendLawyerProfileLearning(workspaceDir, learningLine, "review", {
    auditDir,
    auditTaskId: draft.taskId,
  }).catch(() => {});

  if (assistantId) {
    const line = buildReviewProfileLine(draft.taskId, status, learningNote);
    try {
      appendAssistantProfileMarkdown(resolveLawMindRoot(workspaceDir), assistantId, line);
    } catch {
      /* ignore */
    }
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "memory.profile_updated",
      actor: "system",
      detail: `助手档案更新：assistantId=${assistantId}，标签=${labels.join(",")}`,
    });
  }

  if (reviewLabelsTriggerPlaybook(labels)) {
    const playbookLine = buildClausePlaybookReviewLine(draft.taskId, labels, note);
    try {
      await appendClausePlaybookLearning(workspaceDir, playbookLine);
      await emit(auditDir, {
        taskId: draft.taskId,
        kind: "memory.playbook_updated",
        actor: "system",
        detail: `clause playbook：${playbookLine.slice(0, 500)}`,
      });
    } catch {
      /* ignore */
    }
  }

  if (labels.includes("quality.good_example")) {
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
