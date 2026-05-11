/**
 * Engine — 步骤 2：research。
 */

import { emit } from "../audit/index.js";
import { shortTaskIdForDisplay, taskProgressPrefix } from "../cases/task-display.js";
import {
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  appendTodayLog,
  ensureCaseWorkspace,
  loadMemoryContext,
} from "../memory/index.js";
import { retrieve } from "../retrieval/index.js";
import { ensureTaskRecord, readTaskRecord, updateTaskRecord } from "../tasks/index.js";
import type { ResearchBundle, TaskIntent } from "../types.js";
import type { EngineContext } from "./context.js";

export async function researchTask(
  ctx: EngineContext,
  intent: TaskIntent,
): Promise<ResearchBundle> {
  const { workspaceDir, auditDir, adapters, assistantId } = ctx;

  if (intent.matterId) {
    await ensureCaseWorkspace(workspaceDir, intent.matterId);
    await appendCaseTaskGoal(
      workspaceDir,
      intent.matterId,
      `${intent.summary}（编号 ${shortTaskIdForDisplay(intent.taskId)}）`,
    );
  }
  ensureTaskRecord(workspaceDir, intent, { assistantId });
  const current = readTaskRecord(workspaceDir, intent.taskId);
  if (intent.requiresConfirmation && current?.status !== "confirmed") {
    throw new Error(`任务 ${intent.taskId} 需要先确认后再执行检索。`);
  }

  updateTaskRecord(workspaceDir, intent.taskId, { status: "researching" });
  await emit(auditDir, {
    taskId: intent.taskId,
    kind: "research.started",
    actor: "system",
    detail: intent.summary,
  });

  const memory = await loadMemoryContext(workspaceDir, { matterId: intent.matterId });
  const bundle = await retrieve({ intent, memory, adapters });

  await emit(auditDir, {
    taskId: intent.taskId,
    kind: "research.completed",
    actor: "system",
    detail: `找到来源 ${bundle.sources.length} 条，结论 ${bundle.claims.length} 条，风险标记 ${bundle.riskFlags.length} 条`,
  });
  updateTaskRecord(workspaceDir, intent.taskId, {
    status: "researched",
    matterId: intent.matterId,
    templateId: intent.templateId,
  });

  await appendTodayLog(
    workspaceDir,
    `## 检索完成\n- 任务编号: ${shortTaskIdForDisplay(intent.taskId)}\n- 案件: ${intent.matterId ?? "无"}\n- 来源：${bundle.sources.length}\n- 风险标记：${bundle.riskFlags.join("；") || "无"}`,
  );
  if (intent.matterId) {
    await appendCaseProgress(
      workspaceDir,
      intent.matterId,
      `${taskProgressPrefix(intent.taskId)}检索完成：来源 ${bundle.sources.length} 条，结论 ${bundle.claims.length} 条。`,
    );
    for (const claim of bundle.claims.slice(0, 5)) {
      await appendCaseCoreIssue(
        workspaceDir,
        intent.matterId,
        `${claim.text}（来源模型: ${claim.model}，置信度: ${Math.round(claim.confidence * 100)}%）`,
      );
    }
    for (const risk of bundle.riskFlags) {
      await appendCaseRiskNote(
        workspaceDir,
        intent.matterId,
        `${taskProgressPrefix(intent.taskId)}风险提示：${risk}`,
      );
    }
    for (const missing of bundle.missingItems) {
      await appendCaseRiskNote(
        workspaceDir,
        intent.matterId,
        `${taskProgressPrefix(intent.taskId)}待补充：${missing}`,
      );
    }
  }

  return bundle;
}
