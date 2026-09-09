/**
 * Engine 内部共享工具：bootstrap warning emit、commitPlannedIntent、persistDraftPipeline。
 *
 * 所有调用都通过 `EngineContext` 传入显式参数，避免与原闭包式 factory 共享隐藏状态。
 */

import {
  createPlannedDeliverable,
  linkDraftToDeliverable,
} from "../application/services/deliverable-service.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { openQueueItem } from "../application/services/queue-write-service.js";
import { emit } from "../audit/index.js";
import { taskProgressPrefix } from "../cases/task-display.js";
import { buildDeliverableFromDraft } from "../core/contracts.js";
import {
  specRequiresReasoningGraphAtDraft,
  validateReasoningGraphAtDraft,
} from "../deliverables/reasoning-validator.js";
import { getDeliverableSpec } from "../deliverables/registry.js";
import type { WorkspaceSpecWarning } from "../deliverables/workspace-loader.js";
import {
  buildDecisionHeader,
  evaluateAutoDeliver,
  recordDeliveryAutonomy,
} from "../delivery/index.js";
import {
  persistClauseSnapshot,
  persistDraft,
  persistReasoningSnapshot,
  persistResearchSnapshot,
  readClauseSnapshot,
  readReasoningSnapshot,
} from "../drafts/index.js";
import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import { applySelfReviseToDraft } from "../lint/self-revise.js";
import { appendCaseProgress, appendTodayLog } from "../memory/index.js";
import { recordLintRunEvent } from "../metrics/runtime-events.js";
import { hasCriticNotes, runDraftCritic } from "../reasoning/draft-critic.js";
import { buildClauseGraphFromDraft, buildLegalReasoningGraph } from "../reasoning/index.js";
import { resolveDefaultAssignee } from "../routing/defaults.js";
import { maybeApplyForcedPeerReview } from "../routing/peer-review-gate.js";
import { stanceSelfCheck } from "../stance/self-check.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  syncDraftToTaskRecord,
  taskIntentFromRecord,
  updateTaskRecord,
} from "../tasks/index.js";
import type { ArtifactDraft, ResearchBundle, TaskIntent } from "../types.js";
import { upsertLawyerWorkFromPersist } from "../work/store.js";
import type { EngineContext } from "./context.js";
import { classifyAudienceFromIntent, classifyDeliverableKindFromIntent } from "./role-helpers.js";

/** 把工作区交付物规范解析中的 warnings 写入审计日志（best-effort）。 */
export async function emitWorkspaceSpecWarnings(
  auditDir: string,
  warnings: WorkspaceSpecWarning[],
): Promise<void> {
  for (const w of warnings) {
    try {
      await emit(auditDir, {
        taskId: "system",
        kind: "deliverable.spec.invalid",
        actor: "system",
        detail: `${w.file}: ${w.message}`,
      });
    } catch {
      // 审计日志写入失败不应影响 engine 启动。
    }
  }
}

/** 任务计划落盘 + 审计 + 案件目录初始化 + 当日日志 + matter/deliverable JSON 真相源（W4）。 */
export function commitPlannedIntent(ctx: EngineContext, intent: TaskIntent): void {
  const { workspaceDir, auditDir, assistantId } = ctx;
  const routed = resolveDefaultAssignee({
    workspaceDir,
    kind: intent.kind,
    deliverableType: intent.deliverableType,
    fallbackAssistantId: assistantId,
    auditDir,
    taskId: intent.taskId,
  });
  const resolvedAssistantId = routed.assistantId ?? assistantId;
  const { created } = ensureTaskRecord(workspaceDir, intent, {
    assistantId: resolvedAssistantId,
  });
  if (created) {
    void emit(auditDir, {
      taskId: intent.taskId,
      kind: "task.created",
      actor: "system",
      detail: intent.summary,
    });
  }
  if (intent.matterId) {
    try {
      createMatterIfMissing(workspaceDir, {
        matterId: intent.matterId,
        title: intent.summary,
      });
      createPlannedDeliverable(workspaceDir, {
        matterId: intent.matterId,
        deliverableId: intent.taskId,
        taskId: intent.taskId,
        kind: classifyDeliverableKindFromIntent(intent),
        audience: classifyAudienceFromIntent(intent),
        templateId: intent.templateId,
      });
    } catch (err) {
      void emit(auditDir, {
        taskId: intent.taskId,
        kind: "matter.write_failed",
        actor: "system",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  void appendTodayLog(
    workspaceDir,
    `## 任务计划\n- ID: ${intent.taskId}\n- 类型: ${intent.kind}\n- 摘要: ${intent.summary}\n- 案件: ${intent.matterId ?? "无"}`,
  );
  upsertLawyerWorkFromPersist(workspaceDir, {
    taskId: intent.taskId,
    matterId: intent.matterId,
    title: intent.summary,
    status: "running",
    source: "chat",
  });
}

/** 草稿生成后的统一持久化与审计。 */
export function persistDraftPipeline(
  ctx: EngineContext,
  draft: ArtifactDraft,
  bundle: ResearchBundle,
): void {
  const { workspaceDir, auditDir } = ctx;
  void appendTodayLog(
    workspaceDir,
    `## 草稿生成\n- 模板: ${draft.templateId}\n- 输出: ${draft.output}`,
  );
  void emit(auditDir, {
    taskId: draft.taskId,
    kind: "draft.created",
    actor: "system",
    detail: `模板：${draft.templateId}，格式：${draft.output}`,
  });
  persistResearchSnapshot(workspaceDir, bundle);
  const tr = readTaskRecord(workspaceDir, draft.taskId);
  const spec = getDeliverableSpec(draft.deliverableType);
  const requiresGraph = specRequiresReasoningGraphAtDraft(spec);

  let graph = readReasoningSnapshot(workspaceDir, draft.taskId);
  if (!graph && (requiresGraph || tr)) {
    const intent = tr
      ? taskIntentFromRecord(tr, draft)
      : {
          taskId: draft.taskId,
          kind: "draft.word" as const,
          output: draft.output,
          instruction: draft.summary,
          summary: draft.summary,
          riskLevel: spec?.defaultRiskLevel ?? ("medium" as const),
          models: ["legal" as const],
          requiresConfirmation: false,
          createdAt: draft.createdAt,
          matterId: draft.matterId,
          templateId: draft.templateId,
          deliverableType: draft.deliverableType,
        };
    graph = buildLegalReasoningGraph({ intent, bundle });
    persistReasoningSnapshot(workspaceDir, graph);
  }
  if (graph) {
    draft.hasLegalReasoningSnapshot = true;
  }

  if (!hasCriticNotes(draft)) {
    const criticized = runDraftCritic(draft);
    draft.reviewNotes = criticized.draft.reviewNotes;
    persistClauseSnapshot(workspaceDir, criticized.graph);
  } else if (!readClauseSnapshot(workspaceDir, draft.taskId)) {
    persistClauseSnapshot(workspaceDir, buildClauseGraphFromDraft(draft));
  }

  if (requiresGraph) {
    const graphReport = validateReasoningGraphAtDraft(draft, workspaceDir, { spec });
    if (!graphReport.ready) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.reasoning_graph_missing",
        actor: "system",
        detail: graphReport.hint ?? "LegalReasoningGraph snapshot missing at draft persist.",
      });
    }
  }

  const riskLevel = spec?.defaultRiskLevel ?? "medium";
  const selfRevise = applySelfReviseToDraft(draft);
  const stanceHits = stanceSelfCheck(workspaceDir, draftTextFromUnknown(draft));
  if (stanceHits.length > 0) {
    selfRevise.residual.push(...stanceHits);
    selfRevise.summaryZh = `已做格式规范化 ${selfRevise.applied.length} 处；${selfRevise.residual.length} 处需你定夺`;
  }
  const lint = runLegalLint(draftTextFromUnknown(draft), undefined, undefined, undefined, {
    deliverableType: draft.deliverableType,
  });
  recordLintRunEvent(workspaceDir, {
    taskId: draft.taskId,
    matterId: draft.matterId,
    deliverableType: draft.deliverableType,
    ruleIds: lint.findings.map((f) => f.ruleId),
    failCount: lint.blockerCount + lint.warningCount,
    blockerCount: lint.blockerCount,
    warningCount: lint.warningCount,
  });
  if (!draft.decisionHeader) {
    draft.decisionHeader = buildDecisionHeader({
      title: draft.title,
      lint,
      selfRevise: {
        rounds: selfRevise.rounds,
        appliedCount: selfRevise.applied.length,
        residualCount: selfRevise.residual.length,
      },
      riskLevel,
    });
  }
  const auto = evaluateAutoDeliver({ workspaceDir, draft, riskLevel });
  const shouldAutoDeliver = auto.shouldAutoDeliver && draft.decisionHeader?.ready === "usable";
  if (shouldAutoDeliver) {
    draft.reviewStatus = "approved";
    draft.reviewedBy = draft.reviewedBy ?? "system:auto_deliver";
    draft.reviewedAt = draft.reviewedAt ?? new Date().toISOString();
    recordDeliveryAutonomy(workspaceDir, draft, "unattended");
    void emit(auditDir, {
      taskId: draft.taskId,
      kind: "draft.auto_delivered",
      actor: "system",
      detail: "内部低风险且渐进自主已解锁，机械核对无硬伤。外发仍须签批。",
    });
  } else {
    recordDeliveryAutonomy(workspaceDir, draft, "attended");
  }

  const storedDraftPath = persistDraft(workspaceDir, draft);
  syncDraftToTaskRecord(workspaceDir, draft, shouldAutoDeliver ? "reviewed" : "drafted");
  updateTaskRecord(workspaceDir, draft.taskId, {
    title: draft.title,
    draftPath: storedDraftPath,
  });
  upsertLawyerWorkFromPersist(workspaceDir, {
    taskId: draft.taskId,
    draftId: draft.taskId,
    matterId: draft.matterId,
    title: draft.title,
    status: shouldAutoDeliver ? "done" : "needs_signoff",
    source: "chat",
  });
  if (draft.matterId) {
    // Serialized via withCaseMdLock; fire-and-forget OK for sync draft pipeline.
    void appendCaseProgress(
      workspaceDir,
      draft.matterId,
      `${taskProgressPrefix(draft.taskId)}已生成草稿：${draft.title}（模板 ${draft.templateId}）。`,
    );
    // W4：双轨写入 deliverables/queue JSON 真相源（best-effort）。
    try {
      linkDraftToDeliverable(workspaceDir, draft, tr ?? undefined);
      const authorAssistantId = tr?.assistantId ?? ctx.assistantId;
      const peerGate = maybeApplyForcedPeerReview({
        workspaceDir,
        auditDir,
        draft,
        authorAssistantId,
      });
      if (!shouldAutoDeliver) {
        const queueTitle = peerGate.applied
          ? `【先互审】草稿待签批：${draft.title}`
          : `草稿待审核：${draft.title}`;
        openQueueItem(workspaceDir, {
          matterId: draft.matterId,
          kind: "need_lawyer_review",
          title: queueTitle,
          relatedTaskId: draft.taskId,
          relatedDeliverableId: draft.taskId,
        });
      }
    } catch (err) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "matter.write_failed",
        actor: "system",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // 防止未来 dead-code prune 把 buildDeliverableFromDraft 当成未使用，保留 reference。
  void buildDeliverableFromDraft;
}
