/**
 * LawMind 主入口 — 第一期最小闭环
 *
 * 链路：
 *   用户指令
 *     -> route()            Instruction Router
 *     -> [律师确认]          人工审核点 #1
 *     -> loadMemoryContext() Memory Layer
 *     -> retrieve()         Retrieval Layer
 *     -> [律师审核]          人工审核点 #2（高风险任务）
 *     -> renderDocx()        Artifact Layer
 *     -> emit(audit)         Audit Layer
 *
 * 使用方式：
 *   const engine = createLawMindEngine({ workspaceDir, outputDir, adapters });
 *   const intent = engine.plan("请整理XX合同审查意见并生成律师函");
 *   // 展示 intent.summary 给律师，等待确认
 *   const bundle = await engine.research(intent);
 *   // 展示 bundle 给律师，等待审核（高风险时）
 *   const draft = buildDraft(bundle, intent);
 *   // 展示 draft.sections 给律师，等待批准
 *   const result = await engine.render(draft);
 */

import path from "node:path";
import { renderDocx } from "./artifacts/render-docx.js";
import { renderPptx } from "./artifacts/render-pptx.js";
import { emit } from "./audit/index.js";
import {
  buildMatterIndex,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "./cases/index.js";
import { persistDraft, readDraft } from "./drafts/index.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  appendTodayLog,
  ensureCaseWorkspace,
  loadMemoryContext,
} from "./memory/index.js";
import { buildDraft, buildDraftAsync } from "./reasoning/index.js";
import { retrieve, type RetrievalAdapter } from "./retrieval/index.js";
import { route, routeAsync, type RouteInput } from "./router/index.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  syncDraftToTaskRecord,
  updateTaskRecord,
} from "./tasks/index.js";
import type {
  ArtifactDraft,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  ResearchBundle,
  ReviewStatus,
  TaskIntent,
  TaskRecord,
} from "./types.js";

// ─────────────────────────────────────────────
// 引擎配置
// ─────────────────────────────────────────────

export type LawMindEngineConfig = {
  /** 工作区根目录，内含 MEMORY.md / LAWYER_PROFILE.md / memory/ */
  workspaceDir: string;
  /** 最终产物输出目录（默认 workspaceDir/artifacts） */
  outputDir?: string;
  /** 检索适配器列表，按优先级排序 */
  adapters: RetrievalAdapter[];
  /** 多助手：写入任务记录归因 */
  assistantId?: string;
};

// ─────────────────────────────────────────────
// 引擎
// ─────────────────────────────────────────────

export type LawMindEngine = {
  /** 步骤 1：解析指令，生成任务意图（供律师确认） */
  plan: (instruction: string, opts?: Omit<RouteInput, "instruction">) => TaskIntent;
  /** 步骤 1（异步）：可选模型路由（LAWMIND_ROUTER_MODE=model） */
  planAsync: (instruction: string, opts?: Omit<RouteInput, "instruction">) => Promise<TaskIntent>;
  /** 步骤 1.5：律师确认任务后才允许进入高风险检索 */
  confirm: (taskId: string, opts?: { actorId?: string; note?: string }) => Promise<TaskRecord>;
  /** 步骤 2：执行检索（律师确认后调用） */
  research: (intent: TaskIntent) => Promise<ResearchBundle>;
  /** 步骤 3：生成草稿（供律师审核） */
  draft: (
    intent: TaskIntent,
    bundle: ResearchBundle,
    opts?: { title?: string; templateId?: string },
  ) => ArtifactDraft;
  /** 步骤 3（异步）：可选模型推理（LAWMIND_REASONING_MODE=model） */
  draftAsync: (
    intent: TaskIntent,
    bundle: ResearchBundle,
    opts?: { title?: string; templateId?: string },
  ) => Promise<ArtifactDraft>;
  /** 步骤 4：记录律师审核结果并写入任务状态 */
  review: (
    draft: ArtifactDraft,
    opts?: { actorId?: string; status?: Exclude<ReviewStatus, "pending">; note?: string },
  ) => Promise<ArtifactDraft>;
  /** 步骤 5：渲染文书（律师审核草稿后调用，draft.reviewStatus 须为 approved） */
  render: (draft: ArtifactDraft) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  /** 读取持久化任务状态 */
  getTaskState: (taskId: string) => TaskRecord | undefined;
  /** 读取持久化草稿 */
  getDraft: (taskId: string) => ArtifactDraft | undefined;
  /** 聚合读取案件索引 */
  getMatterIndex: (matterId: string) => Promise<MatterIndex>;
  /** 读取案件总览列表 */
  listMatterOverviews: () => Promise<MatterOverview[]>;
  /** 读取案件摘要 */
  getMatterSummary: (matterId: string) => Promise<MatterSummary>;
  /** 在案件内搜索 */
  searchMatter: (matterId: string, query: string) => Promise<MatterSearchHit[]>;
};

export function createLawMindEngine(config: LawMindEngineConfig): LawMindEngine {
  const { workspaceDir, adapters } = config;
  const assistantId = config.assistantId;
  const outputDir = config.outputDir ?? path.join(workspaceDir, "artifacts");
  const auditDir = path.join(workspaceDir, "audit");

  function commitPlannedIntent(intent: TaskIntent) {
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
      void ensureCaseWorkspace(workspaceDir, intent.matterId);
    }
    void appendTodayLog(
      workspaceDir,
      `## 任务计划\n- ID: ${intent.taskId}\n- 类型: ${intent.kind}\n- 摘要: ${intent.summary}\n- 案件: ${intent.matterId ?? "无"}`,
    );
  }

  function persistDraftPipeline(draft: ArtifactDraft) {
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
        `任务 ${draft.taskId} 已生成草稿：${draft.title}（模板 ${draft.templateId}）。`,
      );
    }
  }

  return {
    plan(instruction, opts = {}) {
      const intent = route({ instruction, ...opts });
      commitPlannedIntent(intent);
      return intent;
    },

    async planAsync(instruction, opts = {}) {
      const intent = await routeAsync({ instruction, ...opts });
      commitPlannedIntent(intent);
      return intent;
    },

    async confirm(taskId, opts = {}) {
      const record = updateTaskRecord(workspaceDir, taskId, { status: "confirmed" });
      if (!record) {
        throw new Error(`任务不存在，无法确认：${taskId}`);
      }

      await emit(auditDir, {
        taskId,
        kind: "task.confirmed",
        actor: "lawyer",
        actorId: opts.actorId ?? "lawyer:system",
        detail: opts.note ?? "任务已确认，可进入执行阶段。",
      });
      await appendTodayLog(
        workspaceDir,
        `## 任务确认\n- 任务: ${taskId}\n- 审核人: ${opts.actorId ?? "lawyer:system"}`,
      );
      if (record.matterId) {
        await appendCaseProgress(
          workspaceDir,
          record.matterId,
          `任务 ${taskId} 已确认，可进入执行阶段。`,
        );
      }
      return record;
    },

    async research(intent) {
      if (intent.matterId) {
        await ensureCaseWorkspace(workspaceDir, intent.matterId);
        await appendCaseTaskGoal(
          workspaceDir,
          intent.matterId,
          `任务 ${intent.taskId}: ${intent.summary}`,
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
        `## 检索完成\n- 任务: ${intent.taskId}\n- 案件: ${intent.matterId ?? "无"}\n- 来源：${bundle.sources.length}\n- 风险标记：${bundle.riskFlags.join("；") || "无"}`,
      );
      if (intent.matterId) {
        await appendCaseProgress(
          workspaceDir,
          intent.matterId,
          `任务 ${intent.taskId} 检索完成：来源 ${bundle.sources.length} 条，结论 ${bundle.claims.length} 条。`,
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
            `任务 ${intent.taskId} 风险提示：${risk}`,
          );
        }
        for (const missing of bundle.missingItems) {
          await appendCaseRiskNote(
            workspaceDir,
            intent.matterId,
            `任务 ${intent.taskId} 待补充：${missing}`,
          );
        }
      }

      return bundle;
    },

    draft(intent, bundle, opts = {}) {
      const draft = buildDraft({
        intent,
        bundle,
        title: opts.title,
        templateId: opts.templateId,
      });
      persistDraftPipeline(draft);
      return draft;
    },

    async draftAsync(intent, bundle, opts = {}) {
      const draft = await buildDraftAsync({
        intent,
        bundle,
        title: opts.title,
        templateId: opts.templateId,
      });
      persistDraftPipeline(draft);
      return draft;
    },

    async review(draft, opts = {}) {
      const status = opts.status ?? "approved";
      draft.reviewStatus = status;
      draft.reviewedBy = opts.actorId ?? draft.reviewedBy ?? "lawyer:system";
      draft.reviewedAt = draft.reviewedAt ?? new Date().toISOString();
      if (opts.note) {
        draft.reviewNotes.push(opts.note);
      }

      await emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.reviewed",
        actor: "lawyer",
        actorId: draft.reviewedBy,
        detail: `审核状态：${status}${opts.note ? `；备注：${opts.note}` : ""}`,
      });
      const storedDraftPath = persistDraft(workspaceDir, draft);
      syncDraftToTaskRecord(workspaceDir, draft, status === "rejected" ? "rejected" : "reviewed");
      updateTaskRecord(workspaceDir, draft.taskId, {
        title: draft.title,
        draftPath: storedDraftPath,
      });
      await appendTodayLog(
        workspaceDir,
        `## 草稿审核\n- 任务: ${draft.taskId}\n- 状态: ${status}\n- 审核人: ${draft.reviewedBy}`,
      );
      if (draft.matterId) {
        await appendCaseProgress(
          workspaceDir,
          draft.matterId,
          `任务 ${draft.taskId} 草稿审核完成：${status}。`,
        );
        if (opts.note) {
          await appendCaseRiskNote(
            workspaceDir,
            draft.matterId,
            `任务 ${draft.taskId} 审核备注：${opts.note}`,
          );
        }
      }
      return draft;
    },

    async render(draft) {
      if (draft.reviewStatus !== "approved") {
        return {
          ok: false,
          error: `文书未通过审核（${draft.reviewStatus}），请律师先确认草稿。`,
        };
      }

      await emit(auditDir, {
        taskId: draft.taskId,
        kind: "artifact.rendered",
        actor: "system",
        detail: `模板：${draft.templateId}，格式：${draft.output}`,
      });

      const result =
        draft.output === "pptx"
          ? await renderPptx(draft, outputDir)
          : draft.output === "docx"
            ? await renderDocx(draft, outputDir)
            : {
                ok: false,
                error: `当前不支持渲染格式：${draft.output}（仅支持 docx / pptx）。`,
              };

      if (result.ok && result.outputPath) {
        draft.outputPath = result.outputPath;
        const storedDraftPath = persistDraft(workspaceDir, draft);
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "artifact.rendered",
          actor: "system",
          detail: `输出路径：${result.outputPath}`,
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
            `任务 ${draft.taskId} 已完成渲染：${draft.title}。`,
          );
          await appendCaseArtifact(
            workspaceDir,
            draft.matterId,
            `${draft.title} -> ${result.outputPath}`,
          );
        }
      }

      return result;
    },

    getTaskState(taskId) {
      return readTaskRecord(workspaceDir, taskId);
    },

    getDraft(taskId) {
      return readDraft(workspaceDir, taskId);
    },

    getMatterIndex(matterId) {
      return buildMatterIndex(workspaceDir, matterId);
    },

    listMatterOverviews() {
      return listMatterOverviews(workspaceDir);
    },

    async getMatterSummary(matterId) {
      const index = await buildMatterIndex(workspaceDir, matterId);
      return summarizeMatterIndex(index);
    },

    async searchMatter(matterId, query) {
      const index = await buildMatterIndex(workspaceDir, matterId);
      return searchMatterIndex(index, query);
    },
  };
}

// 重导出核心类型，方便外部直接从入口引用
export type {
  ArtifactDraft,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  ResearchBundle,
  TaskIntent,
} from "./types.js";
export { route, routeAsync } from "./router/index.js";
export {
  buildMatterIndex,
  buildMatterOverview,
  listMatterIds,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "./cases/index.js";
export { ensureCaseWorkspace, loadMemoryContext } from "./memory/index.js";
export { createWorkspaceAdapter } from "./retrieval/index.js";
export { createGeneralModelAdapter, createLegalModelAdapter } from "./retrieval/model-adapters.js";
export { createOpenAICompatibleAdapters } from "./retrieval/openai-compatible.js";
export {
  createDomesticGeneralAdaptersFromEnv,
  createOpenSourceLegalAdaptersFromEnv,
  createLexEdgeAdapterFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "./retrieval/providers.js";
export { readAllAuditLogs, readAuditLog } from "./audit/index.js";
export {
  deriveInstructionTitle,
  listTaskRecords,
  persistAgentInstructionTask,
  readTaskRecord,
} from "./tasks/index.js";
export { listDrafts, readDraft } from "./drafts/index.js";

// Agent — 自主推理循环（第二代架构）
export { createLawMindAgent } from "./agent/index.js";
export type { LawMindAgent } from "./agent/index.js";
export type {
  AgentConfig,
  AgentModelConfig,
  AgentSession,
  AgentTurn,
  AgentTool,
  AgentContext,
} from "./agent/types.js";
