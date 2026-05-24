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
import type { WorkspaceSpecWarning } from "../deliverables/index.js";
import {
  persistDraft,
  persistReasoningSnapshot,
  persistResearchSnapshot,
} from "../drafts/index.js";
import { appendCaseProgress, appendTodayLog } from "../memory/index.js";
import { buildLegalReasoningGraph } from "../reasoning/index.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  syncDraftToTaskRecord,
  taskIntentFromRecord,
  updateTaskRecord,
} from "../tasks/index.js";
import type { ArtifactDraft, ResearchBundle, TaskIntent } from "../types.js";
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
  const { created } = ensureTaskRecord(workspaceDir, intent, { assistantId });
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
  if (tr) {
    const intent = taskIntentFromRecord(tr, draft);
    const graph = buildLegalReasoningGraph({ intent, bundle });
    persistReasoningSnapshot(workspaceDir, graph);
    draft.hasLegalReasoningSnapshot = true;
  }
  const storedDraftPath = persistDraft(workspaceDir, draft);
  syncDraftToTaskRecord(workspaceDir, draft, "drafted");
  updateTaskRecord(workspaceDir, draft.taskId, {
    title: draft.title,
    draftPath: storedDraftPath,
  });
  if (draft.matterId) {
    void appendCaseProgress(
      workspaceDir,
      draft.matterId,
      `${taskProgressPrefix(draft.taskId)}已生成草稿：${draft.title}（模板 ${draft.templateId}）。`,
    );
    // W4：双轨写入 deliverables/queue JSON 真相源（best-effort）。
    try {
      linkDraftToDeliverable(workspaceDir, draft, tr ?? undefined);
      openQueueItem(workspaceDir, {
        matterId: draft.matterId,
        kind: "need_lawyer_review",
        title: `草稿待审核：${draft.title}`,
        relatedTaskId: draft.taskId,
        relatedDeliverableId: draft.taskId,
      });
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
