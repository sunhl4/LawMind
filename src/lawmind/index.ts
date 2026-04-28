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
import { renderDocxWithOptions } from "./artifacts/render-docx.js";
import { renderPptxWithOptions } from "./artifacts/render-pptx.js";
import { appendAssistantProfileMarkdown, buildReviewProfileLine } from "./assistants/profile-md.js";
import { getAssistantById, resolveLawMindRoot } from "./assistants/store.js";
import { emit } from "./audit/index.js";
import {
  buildMatterIndex,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "./cases/index.js";
import {
  loadWorkspaceDeliverableSpecs,
  registerExtraDeliverableSpecs,
  type WorkspaceSpecWarning,
} from "./deliverables/index.js";
import {
  persistDraft,
  persistReasoningSnapshot,
  persistResearchSnapshot,
  readDraft,
  readReasoningSnapshot,
  readResearchSnapshot,
  resolveDraftCitationIntegrity,
} from "./drafts/index.js";
import { resolveDefaultEngineLawyerActorId } from "./engine-actor.js";
import { writeQualityDashboardJson } from "./evaluation/export-json.js";
import { promoteGoldenExample } from "./evaluation/golden.js";
import {
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
} from "./evaluation/metrics.js";
import { persistQualityRecord } from "./evaluation/quality.js";
import { applyReviewLabelsMemoryWrites } from "./learning/apply-review-labels.js";
import { enqueueLearningSuggestion } from "./learning/suggestion-queue.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  appendClausePlaybookLearning,
  appendTodayLog,
  buildClausePlaybookReviewLine,
  ensureCaseWorkspace,
  loadMemoryContext,
  reviewLabelsTriggerPlaybook,
} from "./memory/index.js";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
} from "./memory/lawyer-profile-learning.js";
import { buildDraft, buildDraftAsync, buildLegalReasoningGraph } from "./reasoning/index.js";
import { retrieve, type RetrievalAdapter } from "./retrieval/index.js";
import { route, routeAsync, type RouteInput } from "./router/index.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  syncDraftToTaskRecord,
  taskIntentFromRecord,
  updateTaskRecord,
} from "./tasks/index.js";
import { resolveTemplateForDraft } from "./templates/index.js";
import type {
  ArtifactDraft,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  QualityRecord,
  ResearchBundle,
  ReviewLabel,
  ReviewStatus,
  TaskIntent,
  TaskRecord,
} from "./types.js";

// 把工作区交付物规范解析中的 warnings 写入审计日志（best-effort）。
// 放在此处方便 engine bootstrap 直接调用，无需额外文件。
async function emitWorkspaceSpecWarnings(
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
  /** 步骤 4：记录律师审核结果并写入任务状态
   * 2.0：支持 labels（结构化审核标签），若含 labels 则自动写回律师/助手 PROFILE。
   */
  review: (
    draft: ArtifactDraft,
    opts?: {
      actorId?: string;
      status?: Exclude<ReviewStatus, "pending">;
      note?: string;
      /** 2.0：结构化审核标签，驱动质量学习飞轮 */
      labels?: ReviewLabel[];
      /** 为 true 时标签只入学习队列，不立即写回 PROFILE / Playbook（稍后 adopt） */
      deferMemoryWrites?: boolean;
      /** 桌面审核台传入时用于助手 PROFILE 写回；覆盖引擎 config.assistantId */
      assistantId?: string;
    },
  ) => Promise<ArtifactDraft>;
  /**
   * 将非「待审核」的草稿恢复为待审核，便于落实修改意见后再次签批，或误操作后重审。
   * 已「待审核」的草稿会原样返回。
   */
  reopenDraftReview: (
    taskId: string,
    opts?: { actorId?: string },
  ) => Promise<ArtifactDraft | undefined>;
  /** 步骤 4b（2.0）：计算并持久化当前任务的质量快照 */
  recordQuality: (
    taskId: string,
    opts?: { labels?: ReviewLabel[]; latencyMs?: number },
  ) => Promise<QualityRecord | undefined>;
  /** 步骤 5：渲染文书（律师审核草稿后调用，draft.reviewStatus 须为 approved） */
  render: (
    draft: ArtifactDraft,
    opts?: { templateIdOverride?: string },
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
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

  // 加载工作区私有交付物规范（事务所定制）；解析失败的文件以 warning 形式
  // 写入审计日志，但不阻断 engine 启动 —— 一个坏 JSON 不应让事务所离线。
  const workspaceSpecs = loadWorkspaceDeliverableSpecs(workspaceDir);
  if (workspaceSpecs.specs.length > 0) {
    registerExtraDeliverableSpecs(workspaceSpecs.specs);
  }
  if (workspaceSpecs.warnings.length > 0) {
    void emitWorkspaceSpecWarnings(auditDir, workspaceSpecs.warnings);
  }

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

  function persistDraftPipeline(draft: ArtifactDraft, bundle: ResearchBundle) {
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

      const confirmActor = opts.actorId ?? resolveDefaultEngineLawyerActorId();
      await emit(auditDir, {
        taskId,
        kind: "task.confirmed",
        actor: "lawyer",
        actorId: confirmActor,
        detail: opts.note ?? "任务已确认，可进入执行阶段。",
      });
      await appendTodayLog(
        workspaceDir,
        `## 任务确认\n- 任务: ${taskId}\n- 审核人: ${confirmActor}`,
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
      persistDraftPipeline(draft, bundle);
      return draft;
    },

    async draftAsync(intent, bundle, opts = {}) {
      const draft = await buildDraftAsync({
        intent,
        bundle,
        title: opts.title,
        templateId: opts.templateId,
      });
      persistDraftPipeline(draft, bundle);
      return draft;
    },

    async review(draft, opts = {}) {
      const status = opts.status ?? "approved";
      draft.reviewStatus = status;
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

      // 2.0：若携带结构化标签，写入学习记录并更新记忆文件
      if (labels.length > 0) {
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "draft.review_labeled",
          actor: "lawyer",
          actorId: draft.reviewedBy,
          detail: JSON.stringify({ labels, note: opts.note }),
        });

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
      }

      if (labels.includes("quality.good_example") && opts.deferMemoryWrites !== true) {
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

      const storedDraftPath = persistDraft(workspaceDir, draft);
      syncDraftToTaskRecord(workspaceDir, draft, status === "rejected" ? "rejected" : "reviewed");
      updateTaskRecord(workspaceDir, draft.taskId, {
        title: draft.title,
        draftPath: storedDraftPath,
      });
      await appendTodayLog(
        workspaceDir,
        `## 草稿审核\n- 任务: ${draft.taskId}\n- 状态: ${status}\n- 审核人: ${draft.reviewedBy}${labels.length > 0 ? `\n- 标签: ${labels.join(", ")}` : ""}`,
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

    async reopenDraftReview(taskId, opts = {}) {
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
      await appendTodayLog(
        workspaceDir,
        `## 恢复待审核\n- 任务: ${taskId}\n- 自状态: ${previous}\n- 操作人: ${actor}`,
      );
      if (draft.matterId) {
        await appendCaseProgress(
          workspaceDir,
          draft.matterId,
          `任务 ${taskId} 已恢复为待审核，可再次签批。`,
        );
      }
      return draft;
    },

    async recordQuality(taskId, opts = {}) {
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
        isGoldenExample: labels.includes("quality.good_example"),
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
    },

    async render(draft, opts) {
      if (draft.reviewStatus !== "approved") {
        return {
          ok: false,
          error: `文书未通过审核（${draft.reviewStatus}），请律师先确认草稿。`,
        };
      }

      const override = opts?.templateIdOverride?.trim();
      const effectiveDraft =
        override !== undefined && override.length > 0 ? { ...draft, templateId: override } : draft;

      const templateResolution = await resolveTemplateForDraft({
        workspaceDir,
        draft: effectiveDraft,
      });

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
          detail: `模板：${templateResolution.resolvedId}（请求：${templateResolution.requestedId}，来源：${templateResolution.source}）；格式：${draft.output}；输出路径：${result.outputPath}${fallbackTail}`,
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
      } else if (!result.ok) {
        // Render was attempted (draft was approved) but the renderer returned an error.
        // Emit a distinct kind so auditors can distinguish "never attempted" from "attempted and failed".
        await emit(auditDir, {
          taskId: draft.taskId,
          kind: "artifact.render_failed",
          actor: "system",
          detail: `格式：${draft.output}；模板：${templateResolution.resolvedId}；错误：${result.error ?? "unknown"}`,
        });
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
  BenchmarkResult,
  BenchmarkTask,
  LegalReasoningGraph,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  QualityRecord,
  ResearchBundle,
  ReviewLabel,
  TaskIntent,
} from "./types.js";
export { route, routeAsync } from "./router/index.js";
export {
  buildMatterIndex,
  buildMatterOverview,
  createMatterIfAbsent,
  listMatterIds,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
  isValidMatterId,
  parseOptionalMatterId,
} from "./cases/index.js";
export type { CreateMatterResult } from "./cases/index.js";
export {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
  clientProfileFilePath,
  ensureCaseWorkspace,
  ensureClientProfile,
  ensureFirmProfile,
  clausePlaybookPath,
  courtAndOpponentProfilePath,
  extractClientIdFromCaseMarkdown,
  ensureLawyerProfileSkeleton,
  loadMemoryContext,
} from "./memory/index.js";
export { createWorkspaceAdapter } from "./retrieval/index.js";
export { createGeneralModelAdapter, createLegalModelAdapter } from "./retrieval/model-adapters.js";
export { createOpenAICompatibleAdapters } from "./retrieval/openai-compatible.js";
export {
  createDomesticGeneralAdaptersFromEnv,
  createOpenSourceLegalAdaptersFromEnv,
  createLexEdgeAdapterFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "./retrieval/providers.js";
export {
  readAllAuditLogs,
  readAuditLog,
  buildAuditExportMarkdown,
  buildComplianceAuditMarkdown,
  filterAuditEventsForExport,
  formatAuditExportMarkdown,
  type AuditExportFilters,
} from "./audit/index.js";
export {
  deriveExecutionPlanSteps,
  deriveInstructionTitle,
  listTaskCheckpoints,
  listTaskRecords,
  persistAgentInstructionTask,
  readTaskRecord,
  taskIntentFromRecord,
  taskIntentFromRecordOnly,
  type TaskCheckpoint,
} from "./tasks/index.js";
export {
  listDrafts,
  readDraft,
  resolveDraftCitationIntegrity,
  validateDraftCitationsAgainstBundle,
  type CitationIntegrityResult,
  type DraftCitationIntegrityView,
} from "./drafts/index.js";
export {
  listBuiltInTemplates,
  listUploadedTemplates,
  registerUploadedTemplate,
  resolveTemplateForDraft,
  setUploadedTemplateEnabled,
  type BuiltInTemplateCategory,
} from "./templates/index.js";
export {
  parseLawMindBundleManifest,
  verifyLawMindBundleManifest,
  type LawMindBundleEntryRole,
  type LawMindBundleManifest,
} from "./skills/index.js";

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
export {
  readAssistantProfileMarkdown,
  appendAssistantProfileMarkdown,
  assistantProfilePath,
  buildReviewProfileLine,
  listAssistantProfileSections,
  type AssistantProfileSectionMeta,
} from "./assistants/profile-md.js";
export {
  buildDraft,
  buildDraftAsync,
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildDraftParams,
  type BuildLegalGraphParams,
} from "./reasoning/index.js";
export {
  buildBenchmarkReportMarkdown,
  benchmarkPassesThreshold,
  buildQualityDashboardMarkdown,
  buildQualityReportMarkdown,
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
  listGoldenTaskIds,
  listQualityRecords,
  persistQualityRecord,
  promoteGoldenExample,
  readQualityRecord,
  runBenchmarks,
  writeQualityDashboardJson,
  BUILTIN_BENCHMARK_TASKS,
} from "./evaluation/index.js";
export type { QualityDashboardJsonPayload } from "./evaluation/index.js";
export type {
  GoldenExampleEntry,
  GoldenPromoteResult,
  LawMindEngineForBenchmark,
} from "./evaluation/index.js";
export {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  buildGovernanceReportMarkdown,
  EDITION_FEATURES,
  EDITION_LABELS,
  evaluateBenchmarkGate,
  isFeatureEnabled,
  listEditions,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveEdition,
  workspacePolicyPath,
  type BenchmarkGateResult,
  type EditionContext,
  type EditionFeatureKey,
  type LawMindEdition,
  type LawMindWorkspacePolicy,
  type ResolvedAgentMandatoryRules,
} from "./policy/index.js";
export { buildAcceptancePackMarkdown } from "./delivery/acceptance-pack.js";
export {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  enqueueLearningSuggestion,
  listLearningSuggestions,
  type LearningSuggestionRecord,
} from "./learning/suggestion-queue.js";
export { applyReviewLabelsMemoryWrites } from "./learning/apply-review-labels.js";
export {
  appendClausePlaybookLearning,
  buildClausePlaybookReviewLine,
  buildAgentMemorySourceReport,
  CLAUSE_PLAYBOOK_RELATIVE,
  PLAYBOOK_REVIEW_SECTION,
  reviewLabelsTriggerPlaybook,
  toEngineClientMemorySnapshot,
  type EngineClientMemorySnapshot,
  type MemorySourceLayer,
} from "./memory/index.js";
export { ALL_REVIEW_LABELS, parseReviewLabels } from "./review-labels.js";
export {
  getAssistantPreset,
  listAssistantPresets,
  taskRiskExceedsPresetCeiling,
  type AssistantPresetDefinition,
} from "./agent/assistant-presets.js";
export {
  buildDeliverableFromDraft,
  buildApprovalRequestsFromMatterIndex,
  buildMatterFromIndex,
  buildMatterReadModelFromIndex,
  buildQueueItemsFromMatterIndex,
  type ApprovalRequest,
  type Deadline,
  type Deliverable,
  type DeliverableKind,
  type Matter,
  type MatterReadModel,
  type MatterStatus,
  type MemoryNode,
  type QueueKind,
  type WorkQueueItem,
} from "./core/contracts.js";
export {
  getMatterCockpitSummary,
  getMatterReadModel,
  listMatterCockpitOverviews,
  listMatterReadModels,
} from "./application/services/matter-service.js";
export { listApprovalRequests, listWorkQueueItems } from "./application/services/queue-service.js";

// Deliverable-First Architecture — spec registry + acceptance gate
export {
  BUILT_IN_DELIVERABLE_SPECS,
  getDeliverableSpec,
  isDraftReadyForRender,
  listDeliverableSpecs,
  validateDraftAgainstSpec,
  type AcceptanceCheck,
  type AcceptanceReport,
  type DeliverableSpec,
  type PlaceholderRule,
  type RequiredSection,
  type ValidateDraftFn,
  type ValidateDraftOptions,
} from "./deliverables/index.js";
