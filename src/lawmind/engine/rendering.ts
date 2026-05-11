/**
 * Engine — 步骤 5：render。
 *
 * W9：strict 模式（acceptanceGateStrict feature 开启）下合并双门禁：
 *   1. acceptance gate（章节/占位符/规范结构）— 已存在
 *   2. reasoning gate（IRAC 推理图谱）— W9 新增
 * 任一 blocker 未通过，render 拒绝并返回 reasoningReport 信息。
 */

import { transitionDeliverable } from "../application/services/deliverable-service.js";
import { renderDocxWithOptions } from "../artifacts/render-docx.js";
import { renderPptxWithOptions } from "../artifacts/render-pptx.js";
import { emit } from "../audit/index.js";
import { taskProgressPrefix } from "../cases/task-display.js";
import {
  validateDraftAgainstSpec,
  validateReasoningForDraft,
  type ReasoningReport,
} from "../deliverables/index.js";
import { persistDraft, readReasoningSnapshot } from "../drafts/index.js";
import { appendCaseArtifact, appendCaseProgress, appendTodayLog } from "../memory/index.js";
import { isFeatureEnabled } from "../policy/edition.js";
import { syncDraftToTaskRecord, updateTaskRecord } from "../tasks/index.js";
import { resolveTemplateForDraft, templateResolvedPin } from "../templates/index.js";
import type { ArtifactDraft } from "../types.js";
import type { EngineContext } from "./context.js";

export async function renderDraft(
  ctx: EngineContext,
  draft: ArtifactDraft,
  opts?: { templateIdOverride?: string; strictGates?: boolean },
): Promise<{
  ok: boolean;
  outputPath?: string;
  error?: string;
  acceptanceReport?: ReturnType<typeof validateDraftAgainstSpec>;
  reasoningReport?: ReasoningReport;
}> {
  const { workspaceDir, outputDir, auditDir } = ctx;

  if (draft.reviewStatus !== "approved") {
    return {
      ok: false,
      error: `文书未通过审核（${draft.reviewStatus}），请律师先确认草稿。`,
    };
  }

  // W9：strict 模式合并 acceptance + reasoning 双门禁。
  const strict = opts?.strictGates ?? isFeatureEnabled("acceptanceGateStrict");
  if (strict) {
    const acceptanceReport = validateDraftAgainstSpec(draft);
    const graph = readReasoningSnapshot(workspaceDir, draft.taskId);
    const reasoningReport = validateReasoningForDraft(draft, graph ?? undefined);
    if (!acceptanceReport.ready || (reasoningReport.required && !reasoningReport.ready)) {
      await emit(auditDir, {
        taskId: draft.taskId,
        kind: "artifact.render_blocked",
        actor: "system",
        detail: `acceptance.ready=${acceptanceReport.ready}; reasoning.ready=${reasoningReport.ready} (required=${reasoningReport.required})`,
      });
      return {
        ok: false,
        error:
          "渲染被双门禁拦截：acceptance / reasoning gate 未通过。请在桌面端 LawmindAcceptanceGate 视图查看具体未达成项。",
        acceptanceReport,
        reasoningReport,
      };
    }
  }

  const override = opts?.templateIdOverride?.trim();
  const effectiveDraft =
    override !== undefined && override.length > 0 ? { ...draft, templateId: override } : draft;

  const templateResolution = await resolveTemplateForDraft({
    workspaceDir,
    draft: effectiveDraft,
  });
  const templatePin = templateResolvedPin(templateResolution);
  draft.templateVersion = templatePin;

  const result =
    draft.output === "pptx"
      ? await renderPptxWithOptions(draft, outputDir, {
          templateVariant: templateResolution.variant,
          uploadedTemplate: templateResolution.uploaded,
        })
      : draft.output === "docx"
        ? await renderDocxWithOptions(draft, outputDir, {
            templateVariant: templateResolution.variant,
            uploadedTemplate: templateResolution.uploaded,
          })
        : {
            ok: false,
            error: `当前不支持渲染格式：${draft.output}（仅支持 docx / pptx）。`,
          };

  if (result.ok && result.outputPath) {
    draft.outputPath = result.outputPath;
    if (override !== undefined && override.length > 0) {
      draft.templateId = override;
    }
    const storedDraftPath = persistDraft(workspaceDir, draft);
    const fallbackTail = templateResolution.fallbackReason
      ? `；回退原因：${templateResolution.fallbackReason}`
      : "";
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "artifact.rendered",
      actor: "system",
      detail: `模板 pin：${templatePin}；resolved：${templateResolution.resolvedId}（请求：${templateResolution.requestedId}，来源：${templateResolution.source}）；格式：${draft.output}；输出路径：${result.outputPath}${fallbackTail}`,
    });
    syncDraftToTaskRecord(workspaceDir, draft, "rendered");
    updateTaskRecord(workspaceDir, draft.taskId, {
      title: draft.title,
      draftPath: storedDraftPath,
      outputPath: result.outputPath,
    });
    await appendTodayLog(workspaceDir, `## 文书渲染完成\n- 路径: ${result.outputPath}`);
    if (draft.matterId) {
      await appendCaseProgress(
        workspaceDir,
        draft.matterId,
        `${taskProgressPrefix(draft.taskId)}已完成渲染：${draft.title}。`,
      );
      await appendCaseArtifact(
        workspaceDir,
        draft.matterId,
        `${draft.title} -> ${result.outputPath}`,
      );
      // W4：deliverable 状态翻到 rendered。
      try {
        transitionDeliverable(workspaceDir, draft.matterId, draft.taskId, "rendered", {
          reviewStatus: draft.reviewStatus,
          templateId: draft.templateId,
        });
      } catch (err) {
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "matter.write_failed",
          actor: "system",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (!result.ok) {
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "artifact.render_failed",
      actor: "system",
      detail: `格式：${draft.output}；模板：${templateResolution.resolvedId}；错误：${result.error ?? "unknown"}`,
    });
  }

  return result;
}
