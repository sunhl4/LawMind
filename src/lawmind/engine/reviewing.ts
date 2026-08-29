/**
 * Engine — 步骤 4：review / reopenDraftReview / recordQuality。
 */

import { listPendingApprovals, resolveApproval } from "../application/services/approval-service.js";
import {
  applyDeliverableReviewStamp,
  linkDraftToDeliverable,
  reopenDeliverableReviewStamp,
  syncDraftReviewStatusFromDeliverable,
  transitionDeliverable,
} from "../application/services/deliverable-service.js";
import {
  listQueueItemsForMatter,
  openQueueItem,
  transitionQueueItem,
} from "../application/services/queue-write-service.js";
import { getAssistantById, resolveLawMindRoot } from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { shortTaskIdForDisplay, taskProgressPrefix } from "../cases/task-display.js";
import {
  persistDraft,
  readDraft,
  readReasoningSnapshot,
  readResearchSnapshot,
  resolveDraftCitationIntegrity,
} from "../drafts/index.js";
import { resolveDefaultEngineLawyerActorId } from "../engine-actor.js";
import { writeQualityDashboardJson } from "../evaluation/export-json.js";
import { promoteGoldenExample } from "../evaluation/golden.js";
import {
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
} from "../evaluation/metrics.js";
import { persistQualityRecord } from "../evaluation/quality.js";
import { recordAgentReviewOutcome } from "../learning/agent-specialization.js";
import { applyReviewLabelsMemoryWrites } from "../learning/apply-review-labels.js";
import { recordRejectionRatchet } from "../learning/rejection-ratchet.js";
import { suggestLearningFromDraftReview } from "../learning/review-learning-suggest.js";
import { enqueueLearningSuggestion } from "../learning/suggestion-queue.js";
import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import { appendCaseProgress, appendCaseRiskNote, appendTodayLog } from "../memory/index.js";
import { appendProductMetric } from "../metrics/product-metrics.js";
import { readTaskRecord, syncDraftToTaskRecord, updateTaskRecord } from "../tasks/index.js";
import type { ArtifactDraft, QualityRecord, ReviewLabel, ReviewStatus } from "../types.js";
import type { EngineContext } from "./context.js";

/** Records lint_escape when the draft still has lint findings, or when the lawyer edited. */
export function recordLintEscape(
  workspaceDir: string,
  draft: ArtifactDraft,
  opts?: { lawyerEdited?: boolean },
): boolean {
  const report = runLegalLint(draftTextFromUnknown(draft));
  const lintHits = report.blockerCount + report.warningCount;
  if (lintHits <= 0 && !opts?.lawyerEdited) {
    return false;
  }
  try {
    appendProductMetric(workspaceDir, {
      kind: "lint_escape",
      outcome: lintHits > 0 ? "lint_findings" : "lawyer_edit",
      taskId: draft.taskId,
      matterId: draft.matterId,
      deliverableType: draft.deliverableType,
      meta: {
        blockerCount: report.blockerCount,
        warningCount: report.warningCount,
      },
    });
    return true;
  } catch {
    return false;
  }
}

function rewriteAmplitudeDelta(draft: ArtifactDraft): number {
  const amp = draft.rewriteAmplitude;
  if (!amp) {
    return 0;
  }
  return (amp.absCharDelta ?? 0) + (amp.absParagraphDelta ?? 0);
}

export type ReviewDraftResult = {
  draft: ArtifactDraft;
  matterWriteFailed: boolean;
};

export async function reviewDraft(
  ctx: EngineContext,
  draft: ArtifactDraft,
  opts: {
    actorId?: string;
    status?: Exclude<ReviewStatus, "pending">;
    note?: string;
    labels?: ReviewLabel[];
    deferMemoryWrites?: boolean;
    assistantId?: string;
  } = {},
): Promise<ReviewDraftResult> {
  const { workspaceDir, auditDir, assistantId } = ctx;
  const status = opts.status ?? "approved";
  // reviewStatus is set from deliverable JSON authority below (R-P2-7), not draft-first.
  draft.reviewedBy = opts.actorId ?? draft.reviewedBy ?? resolveDefaultEngineLawyerActorId();
  draft.reviewedAt = draft.reviewedAt ?? new Date().toISOString();
  if (opts.note) {
    draft.reviewNotes.push(opts.note);
  }

  const labels = opts.labels ?? [];
  const labelAssistantId = opts.assistantId ?? assistantId;

  const citationView = resolveDraftCitationIntegrity(workspaceDir, draft);
  if (citationView.checked && !citationView.ok) {
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "draft.citation_integrity",
      actor: "system",
      detail: `${JSON.stringify({
        missingSourceIds: citationView.missingSourceIds,
        sectionsWithIssues: citationView.sectionsWithIssues,
      })} 审核时引用与检索 bundle 不一致（非阻塞，已记录）`,
    });
  }

  await emit(auditDir, {
    taskId: draft.taskId,
    kind: "draft.reviewed",
    actor: "lawyer",
    actorId: draft.reviewedBy,
    detail: `审核状态：${status}${opts.note ? `；备注：${opts.note}` : ""}`,
  });

  if (labels.length > 0) {
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "draft.review_labeled",
      actor: "lawyer",
      actorId: draft.reviewedBy,
      detail: JSON.stringify({ labels, note: opts.note }),
    });
  }

  if ((status === "approved" || status === "modified") && labelAssistantId) {
    const firstPass = status === "approved" && !opts.note?.trim();
    let roleId: string | undefined;
    try {
      const lawMindRoot = resolveLawMindRoot(workspaceDir);
      roleId = getAssistantById(lawMindRoot, labelAssistantId)?.roleId;
    } catch {
      roleId = undefined;
    }
    try {
      recordAgentReviewOutcome({
        workspaceDir,
        assistantId: labelAssistantId,
        roleId,
        firstPass,
      });
    } catch {
      // 特化指标失败不阻断审核
    }
    try {
      appendProductMetric(workspaceDir, {
        kind: firstPass ? "first_pass" : "rewrite",
        outcome: firstPass ? "ok" : status === "modified" ? "modified" : "noted",
        taskId: draft.taskId,
        matterId: draft.matterId,
        deliverableType: draft.deliverableType,
        meta: {
          assistantId: labelAssistantId,
          ...(roleId ? { roleId } : {}),
        },
      });
    } catch {
      // 产品指标失败不阻断审核
    }
  }

  try {
    if (status === "approved" && draft.createdAt && draft.reviewedAt) {
      const durationMs = Date.parse(draft.reviewedAt) - Date.parse(draft.createdAt);
      if (Number.isFinite(durationMs) && durationMs >= 0) {
        appendProductMetric(workspaceDir, {
          kind: "review_duration",
          outcome: "ok",
          taskId: draft.taskId,
          matterId: draft.matterId,
          deliverableType: draft.deliverableType,
          meta: { durationMs },
        });
      }
    }
  } catch {
    // 审阅时长失败不阻断审核
  }

  try {
    const rewriteDelta = rewriteAmplitudeDelta(draft);
    if (status !== "approved") {
      recordLintEscape(workspaceDir, draft);
    } else if (draft.rewriteAmplitude && rewriteDelta > 0) {
      recordLintEscape(workspaceDir, draft, { lawyerEdited: true });
    }
  } catch {
    // 逃逸指标失败不阻断审核
  }

  // R-P2-7：审核态以 deliverables/*.json 为权威口；draft.reviewStatus 仅从该 stamp 同步后再落盘。
  let matterWriteFailed = false;
  if (draft.matterId) {
    try {
      const deliverableStatus =
        status === "approved" ? "approved" : status === "rejected" ? "blocked" : "drafting";
      const stampOpts = {
        reviewStatus: status,
        status: deliverableStatus,
        reviewerId: draft.reviewedBy,
        approvedBy: status === "approved" ? draft.reviewedBy : undefined,
        blockingReasons:
          status === "rejected"
            ? ["rejected_by_reviewer"]
            : status === "modified"
              ? ["changes_requested"]
              : [],
      } as const;
      let stamped = applyDeliverableReviewStamp(
        workspaceDir,
        draft.matterId,
        draft.taskId,
        stampOpts,
      );
      if (!stamped) {
        const tr = readTaskRecord(workspaceDir, draft.taskId);
        linkDraftToDeliverable(workspaceDir, draft, tr ?? undefined);
        stamped = applyDeliverableReviewStamp(
          workspaceDir,
          draft.matterId,
          draft.taskId,
          stampOpts,
        );
      }
      if (stamped) {
        syncDraftReviewStatusFromDeliverable(draft, stamped);
      } else {
        const transitioned = transitionDeliverable(
          workspaceDir,
          draft.matterId,
          draft.taskId,
          deliverableStatus,
          {
            reviewStatus: status,
            reviewerId: draft.reviewedBy,
            approvedBy: status === "approved" ? draft.reviewedBy : undefined,
            blockingReasons: stampOpts.blockingReasons,
          },
        );
        if (transitioned) {
          syncDraftReviewStatusFromDeliverable(draft, transitioned);
        } else {
          matterWriteFailed = true;
          draft.reviewStatus = status;
        }
      }
    } catch (err) {
      matterWriteFailed = true;
      draft.reviewStatus = status;
      await emit(auditDir, {
        taskId: draft.taskId,
        kind: "matter.write_failed",
        actor: "system",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    draft.reviewStatus = status;
  }

  const storedDraftPath = persistDraft(workspaceDir, draft);
  syncDraftToTaskRecord(workspaceDir, draft, status === "rejected" ? "rejected" : "reviewed");
  updateTaskRecord(workspaceDir, draft.taskId, {
    title: draft.title,
    draftPath: storedDraftPath,
  });

  // 学习回写：权威 stamp 与草稿落盘成功后才写入律师/助手档案与范例库——
  // 避免「stamp 失败但偏好已沉淀」的倒挂（matterWriteFailed 时整体跳过）。
  const learningGateOk = !matterWriteFailed;
  if (labels.length > 0 && learningGateOk) {
    const defer = opts.deferMemoryWrites === true;
    if (defer) {
      await enqueueLearningSuggestion(workspaceDir, auditDir, {
        taskId: draft.taskId,
        matterId: draft.matterId,
        reviewStatus: status,
        note: opts.note,
        labels,
        assistantId: labelAssistantId,
      });
    } else {
      await applyReviewLabelsMemoryWrites(workspaceDir, auditDir, draft, {
        status,
        note: opts.note,
        labels,
        assistantId: labelAssistantId,
      });
    }
    try {
      recordRejectionRatchet({
        workspaceDir,
        taskId: draft.taskId,
        status,
        labels,
        note: opts.note,
      });
    } catch {
      /* overlay only */
    }
  }

  if (status === "modified" && learningGateOk) {
    try {
      await suggestLearningFromDraftReview({
        workspaceDir,
        auditDir,
        taskId: draft.taskId,
        status,
        note: opts.note,
        labels,
        assistantId: labelAssistantId,
        skipBecauseLabels: labels.length > 0,
      });
    } catch {
      // 学习建议失败不阻断审核
    }
  }

  if (labels.includes("质量范例") && opts.deferMemoryWrites !== true && learningGateOk) {
    try {
      const promoted = await promoteGoldenExample(workspaceDir, draft.taskId);
      if (promoted?.created) {
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "golden.example_promoted",
          actor: "lawyer",
          actorId: draft.reviewedBy,
          detail: `golden/${draft.taskId}.golden.json`,
        });
      }
    } catch {
      // 磁盘失败不阻断审核
    }
  }

  await appendTodayLog(
    workspaceDir,
    `## 草稿审核\n- 任务编号: ${shortTaskIdForDisplay(draft.taskId)}\n- 状态: ${status}\n- 审核人: ${draft.reviewedBy}${labels.length > 0 ? `\n- 标签: ${labels.join(", ")}` : ""}`,
  );
  if (draft.matterId) {
    await appendCaseProgress(
      workspaceDir,
      draft.matterId,
      `${taskProgressPrefix(draft.taskId)}草稿审核完成：${status}。`,
    );
    if (opts.note) {
      await appendCaseRiskNote(
        workspaceDir,
        draft.matterId,
        `${taskProgressPrefix(draft.taskId)}审核备注：${opts.note}`,
      );
    }
    if (!matterWriteFailed) {
      try {
        const reviewer = draft.reviewedBy ?? "system";
        for (const queueItem of listQueueItemsForMatter(workspaceDir, draft.matterId, {
          status: "open",
        })) {
          if (
            queueItem.relatedTaskId === draft.taskId &&
            (queueItem.kind === "need_lawyer_review" || queueItem.kind === "need_partner_approval")
          ) {
            transitionQueueItem(workspaceDir, draft.matterId, queueItem.queueItemId, "resolved");
          }
        }
        for (const approval of listPendingApprovals(workspaceDir, draft.matterId)) {
          if (approval.deliverableId === draft.taskId) {
            const next =
              status === "approved"
                ? "approved"
                : status === "rejected"
                  ? "rejected"
                  : "needs_changes";
            resolveApproval(workspaceDir, draft.matterId, approval.approvalId, {
              status: next,
              resolvedBy: reviewer,
            });
          }
        }
      } catch (err) {
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "matter.write_failed",
          actor: "system",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { draft, matterWriteFailed };
}

export async function reopenDraftReviewImpl(
  ctx: EngineContext,
  taskId: string,
  opts: { actorId?: string } = {},
): Promise<ArtifactDraft | undefined> {
  const { workspaceDir, auditDir } = ctx;
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return undefined;
  }
  if (draft.reviewStatus === "pending") {
    return draft;
  }
  const previous = draft.reviewStatus;
  draft.reviewStatus = "pending";
  draft.reviewedBy = undefined;
  draft.reviewedAt = undefined;
  const actor = opts.actorId ?? resolveDefaultEngineLawyerActorId();
  await emit(auditDir, {
    taskId,
    kind: "draft.review_reopened",
    actor: "lawyer",
    actorId: actor,
    detail: `自 ${previous} 恢复为待审核`,
  });
  const storedDraftPath = persistDraft(workspaceDir, draft);
  syncDraftToTaskRecord(workspaceDir, draft, "drafted");
  updateTaskRecord(workspaceDir, taskId, {
    title: draft.title,
    draftPath: storedDraftPath,
  });
  if (draft.matterId) {
    try {
      // SSOT 对称回写：deliverable 戳同步回 pending_review，避免 draft/deliverable 双真相漂移。
      const stamped = reopenDeliverableReviewStamp(workspaceDir, draft.matterId, taskId);
      if (!stamped) {
        const tr = readTaskRecord(workspaceDir, taskId);
        linkDraftToDeliverable(workspaceDir, draft, tr ?? undefined);
      }
      const hasOpenReviewQueue = listQueueItemsForMatter(workspaceDir, draft.matterId, {
        status: "open",
      }).some(
        (q) =>
          q.relatedTaskId === taskId &&
          (q.kind === "need_lawyer_review" || q.kind === "need_partner_approval"),
      );
      if (!hasOpenReviewQueue) {
        openQueueItem(workspaceDir, {
          matterId: draft.matterId,
          kind: "need_lawyer_review",
          title: `草稿待审核：${draft.title}`,
          relatedTaskId: taskId,
          relatedDeliverableId: taskId,
        });
      }
      await appendCaseProgress(
        workspaceDir,
        draft.matterId,
        `${taskProgressPrefix(taskId)}已恢复为待审核，可再次签批。`,
      );
    } catch (err) {
      await emit(auditDir, {
        taskId,
        kind: "matter.write_failed",
        actor: "system",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await appendTodayLog(
    workspaceDir,
    `## 恢复待审核\n- 任务编号: ${shortTaskIdForDisplay(taskId)}\n- 自状态: ${previous}\n- 操作人: ${actor}`,
  );
  return draft;
}

export async function recordQualityImpl(
  ctx: EngineContext,
  taskId: string,
  opts: { labels?: ReviewLabel[]; latencyMs?: number } = {},
): Promise<QualityRecord | undefined> {
  const { workspaceDir, auditDir } = ctx;
  const taskRecord = readTaskRecord(workspaceDir, taskId);
  if (!taskRecord) {
    return undefined;
  }
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return undefined;
  }
  const labels = opts.labels ?? [];
  const bundle = readResearchSnapshot(workspaceDir, taskId);
  const graph = readReasoningSnapshot(workspaceDir, taskId);
  let citationValidityRate: number | null = null;
  let issueCoverageRate: number | null = null;
  let riskRecallRate: number | null = null;
  if (bundle) {
    citationValidityRate = computeCitationValidityRate(draft, bundle);
    riskRecallRate = computeRiskRecallRate(draft, bundle);
  }
  if (graph) {
    issueCoverageRate = computeIssueCoverageRate(draft, graph);
  }
  let presetKey: string | undefined;
  if (taskRecord.assistantId) {
    try {
      const lawMindRoot = resolveLawMindRoot(workspaceDir);
      const prof = getAssistantById(lawMindRoot, taskRecord.assistantId);
      presetKey = prof?.presetKey;
    } catch {
      presetKey = undefined;
    }
  }
  const record: QualityRecord = {
    taskId,
    taskKind: taskRecord.kind,
    templateId: taskRecord.templateId,
    assistantId: taskRecord.assistantId,
    matterId: taskRecord.matterId,
    citationValidityRate,
    issueCoverageRate,
    riskRecallRate,
    firstPassApproved: draft.reviewStatus === "approved" && draft.reviewNotes.length === 0,
    reviewStatus: draft.reviewStatus,
    reviewLabels: labels,
    isGoldenExample: labels.includes("质量范例"),
    latencyMs: opts.latencyMs,
    presetKey,
    createdAt: new Date().toISOString(),
  };
  persistQualityRecord(workspaceDir, record);
  await emit(auditDir, {
    taskId,
    kind: "quality.snapshot",
    actor: "system",
    detail: JSON.stringify({
      citationValidityRate,
      issueCoverageRate,
      riskRecallRate,
      firstPassApproved: record.firstPassApproved,
      presetKey,
    }),
  });
  try {
    await writeQualityDashboardJson(workspaceDir);
  } catch {
    // Aggregate JSON export must not block quality recording
  }
  return record;
}
