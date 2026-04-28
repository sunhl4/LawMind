/**
 * Engine-Bridge Tools — Agent 的"双手"
 *
 * 这些工具让 agent 能调用 Engine 的管线能力：
 *   plan_task      → engine.plan()     — 解析指令，生成任务意图
 *   research_task  → engine.research() — 执行检索
 *   draft_document → engine.draft()    — 生成文书草稿
 *   render_document→ engine.render()   — 渲染最终交付物
 *   execute_workflow → 一键完整流程    — plan → research → draft → render
 *
 * 这是让 agent 从"只会查看"变成"能干活、能交付"的关键层。
 */

import { validateDraftAgainstSpec } from "../../deliverables/index.js";
import { listDrafts, validateDraftCitationsAgainstBundle } from "../../drafts/index.js";
import { createLawMindEngine, type LawMindEngineConfig } from "../../index.js";
import { createWorkspaceAdapter } from "../../retrieval/index.js";
import type { RetrievalAdapter } from "../../retrieval/index.js";
import { createOpenAICompatibleAdapters } from "../../retrieval/openai-compatible.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../retrieval/providers.js";
import { readTaskRecord, taskIntentFromRecordOnly } from "../../tasks/index.js";
import {
  listBuiltInTemplates,
  listUploadedTemplates,
  registerUploadedTemplate,
  setUploadedTemplateEnabled,
} from "../../templates/index.js";
import type { TaskIntent } from "../../types.js";
import type { AgentContext, AgentTool, ToolCallResult } from "../types.js";

const MAX_INSTRUCTION_LENGTH = 4000;
const MAX_TITLE_LENGTH = 200;
const MAX_AUDIENCE_LENGTH = 100;
const MAX_TEMPLATE_ID_LENGTH = 96;
const MATTER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;
const TEMPLATE_ID_RE = /^(word|ppt|upload)\/[a-zA-Z0-9][a-zA-Z0-9._-]{1,95}$/;

function asNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} 不能为空`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${field} 长度不能超过 ${maxLength}`);
  }
  return trimmed;
}

function asOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return asNonEmptyString(value, field, maxLength);
}

function resolveMatterId(raw: unknown, fallback?: string): string | undefined {
  const candidate = typeof raw === "string" ? raw.trim() : fallback;
  if (!candidate) {
    return undefined;
  }
  if (!MATTER_ID_RE.test(candidate)) {
    throw new Error("matter_id 格式不合法，只允许字母/数字/._-");
  }
  return candidate;
}

function resolveTemplateId(raw: unknown): string | undefined {
  const candidate = asOptionalString(raw, "template_id", MAX_TEMPLATE_ID_LENGTH);
  if (!candidate) {
    return undefined;
  }
  if (!TEMPLATE_ID_RE.test(candidate)) {
    throw new Error("template_id 格式不合法，示例：word/legal-memo-default 或 upload/firm-brief");
  }
  return candidate;
}

function resolveLatestDraftTaskId(workspaceDir: string): string | undefined {
  const drafts = listDrafts(workspaceDir);
  const preferred = drafts.find((draft) => !draft.outputPath) ?? drafts[0];
  return preferred?.taskId;
}

function canDraftWithoutResearch(intent: { kind: string; deliverableType?: string }): boolean {
  return intent.kind === "draft.word" && Boolean(intent.deliverableType);
}

/** 同一 turn 内已有工具返回 clarificationQuestions 时，阻止并行重型管线。 */
function blockHeavyPipelineIfClarificationPending(ctx: AgentContext): ToolCallResult | null {
  if (!ctx.clarificationBlockingHeavyTools) {
    return null;
  }
  return {
    ok: false,
    error:
      "仍有待澄清事项：请先请律师回答上一轮列出的问题后，再执行检索、起草、完整工作流或渲染。可直接在对话中补充要点。",
  };
}

/**
 * 通用模型连接信息（与桌面 `buildAgentConfig` / 向导写入的变量对齐）。
 */
function resolveGeneralOpenAICompatibleFromEnv(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const baseUrl =
    process.env.LAWMIND_AGENT_BASE_URL?.trim() ||
    process.env.QWEN_BASE_URL?.trim() ||
    process.env.LAWMIND_QWEN_BASE_URL?.trim();
  const apiKey =
    process.env.LAWMIND_AGENT_API_KEY?.trim() ||
    process.env.QWEN_API_KEY?.trim() ||
    process.env.LAWMIND_QWEN_API_KEY?.trim();
  const model =
    process.env.LAWMIND_AGENT_MODEL?.trim() ||
    process.env.QWEN_MODEL?.trim() ||
    process.env.LAWMIND_QWEN_MODEL?.trim();

  if (baseUrl && apiKey && model) {
    return { baseUrl, apiKey, model };
  }

  const qwenKey = process.env.LAWMIND_QWEN_API_KEY?.trim();
  const qwenModel = process.env.LAWMIND_QWEN_MODEL?.trim();
  if (qwenKey && qwenModel) {
    return {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: qwenKey,
      model: qwenModel,
    };
  }

  return null;
}

/**
 * 根据环境变量创建 retrieval adapters。
 * - 默认 `LAWMIND_RETRIEVAL_MODE=single`：通用与法律检索共用同一 OpenAI-compatible 端点。
 * - `dual`：通用用 LAWMIND_AGENT_* / QWEN_*，法律用 CHATLAW / LAWGPT / PARTNER 等（见 providers.ts）；未配置法律端点时回退为通用模型做法务检索。
 */
function buildAdaptersFromEnv(workspaceDir: string): RetrievalAdapter[] {
  const adapters: RetrievalAdapter[] = [createWorkspaceAdapter(workspaceDir)];

  const modeRaw = (process.env.LAWMIND_RETRIEVAL_MODE ?? "single").trim().toLowerCase();
  const mode = modeRaw === "dual" ? "dual" : "single";

  const generalCfg = resolveGeneralOpenAICompatibleFromEnv();
  if (!generalCfg) {
    return adapters;
  }

  if (mode === "single") {
    adapters.push(
      ...createOpenAICompatibleAdapters({
        general: generalCfg,
        legal: generalCfg,
      }),
    );
    return adapters;
  }

  adapters.push(...createOpenAICompatibleAdapters({ general: generalCfg }));

  const legalFromEnv = [
    ...createOpenSourceLegalAdaptersFromEnv(),
    ...createPartnerLegalAdapterFromEnv(),
  ];
  if (legalFromEnv.length > 0) {
    adapters.push(...legalFromEnv);
  } else {
    adapters.push(...createOpenAICompatibleAdapters({ legal: generalCfg }));
  }

  return adapters;
}

/**
 * 仅用于测试：根据当前 `process.env` 构造引擎检索适配器列表。
 */
export function buildLawMindRetrievalAdaptersFromEnvForTest(
  workspaceDir: string,
): RetrievalAdapter[] {
  return buildAdaptersFromEnv(workspaceDir);
}

function getEngine(ctx: AgentContext) {
  const adapters = buildAdaptersFromEnv(ctx.workspaceDir);
  const config: LawMindEngineConfig = {
    workspaceDir: ctx.workspaceDir,
    adapters,
    assistantId: ctx.assistantId,
  };
  return createLawMindEngine(config);
}

// ─────────────────────────────────────────────
// plan_task — 解析指令生成任务意图
// ─────────────────────────────────────────────

export const planTask: AgentTool = {
  definition: {
    name: "plan_task",
    description:
      "解析一条法律工作指令，生成结构化的任务意图（TaskIntent）。包含任务类型、风险等级、输出格式、是否需要确认等。这是启动任何法律工作的第一步。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "律师的工作指令", required: true },
      audience: { type: "string", description: "目标受众（内部/客户/对方/法院）" },
      matter_id: { type: "string", description: "关联案件 ID" },
    },
  },
  async execute(params, ctx) {
    try {
      const engine = getEngine(ctx);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          kind: intent.kind,
          deliverableType: intent.deliverableType,
          summary: intent.summary,
          riskLevel: intent.riskLevel,
          output: intent.output,
          requiresConfirmation: intent.requiresConfirmation,
          models: intent.models,
          matterId: intent.matterId,
          templateId: intent.templateId,
          acceptanceCriteria: intent.acceptanceCriteria,
          clarificationQuestions: intent.clarificationQuestions,
        },
      };
    } catch (err) {
      return { ok: false, error: `计划失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// research_task — 执行检索
// ─────────────────────────────────────────────

export const researchTask: AgentTool = {
  definition: {
    name: "research_task",
    description:
      "对已计划的任务执行法律检索。会调用配置的模型（通用+法律专用）进行检索和分析，返回来源、结论、风险标记等。高风险任务需要先确认才能检索。",
    category: "analyze",
    parameters: {
      task_id: { type: "string", description: "任务 ID（由 plan_task 返回）", required: true },
      instruction: { type: "string", description: "原始指令（用于重建 intent）", required: true },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const taskId = asNonEmptyString(params.task_id, "task_id", 128);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });
      // Override taskId if provided (to reuse existing task)
      (intent as { taskId: string }).taskId = taskId;

      // Auto-confirm if needed
      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, {
          actorId: ctx.actorId,
          note: "Agent 自动确认（高风险任务将在交付前再次请求律师审批）",
        });
      }

      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        return {
          ok: false,
          error: "检索返回空结果（sources=0, claims=0）。请检查模型配置或补充案件资料后重试。",
        };
      }

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          sourcesCount: bundle.sources.length,
          claimsCount: bundle.claims.length,
          riskFlags: bundle.riskFlags,
          missingItems: bundle.missingItems,
          topClaims: bundle.claims.slice(0, 5).map((c) => ({
            text: c.text,
            model: c.model,
            confidence: Math.round(c.confidence * 100),
          })),
          topSources: bundle.sources.slice(0, 5).map((s) => ({
            title: s.title,
            kind: s.kind,
            citation: s.citation,
          })),
        },
      };
    } catch (err) {
      return { ok: false, error: `检索失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// draft_document — 生成文书草稿
// ─────────────────────────────────────────────

export const draftDocument: AgentTool = {
  definition: {
    name: "draft_document",
    description:
      "基于检索结果生成文书草稿。会产出结构化的文书（包含标题、章节、引用等），并自动持久化到工作区。返回 data.citationIntegrity：将草稿章节 citations 与检索 bundle 来源 ID 对照（ok / missingSourceIds / sectionsWithIssues）。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "原始工作指令", required: true },
      title: { type: "string", description: "文书标题（可选，自动推断）" },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
      template_id: {
        type: "string",
        description:
          "模板 ID（如 word/legal-memo-default、ppt/client-brief-default、upload/firm-brief）",
      },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const title = asOptionalString(params.title, "title", MAX_TITLE_LENGTH);
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const templateId = resolveTemplateId(params.template_id);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });

      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, { actorId: ctx.actorId });
      }

      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          // Deliverable-first drafting can still produce a full editable draft with placeholders.
        } else {
          return {
            ok: false,
            error: "检索返回空结果，无法生成可靠草稿。请补充信息后重试。",
          };
        }
      }
      const draft = await engine.draftAsync(intent, bundle, {
        title,
        templateId,
      });

      return {
        ok: true,
        data: {
          taskId: draft.taskId,
          title: draft.title,
          output: draft.output,
          templateId: draft.templateId,
          deliverableType: draft.deliverableType,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => ({
            heading: s.heading,
            bodyPreview: s.body.slice(0, 100),
            citationsCount: s.citations?.length ?? 0,
          })),
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
          acceptanceCriteria: draft.acceptanceCriteria,
          clarificationQuestions: draft.clarificationQuestions,
          deliveryReadiness:
            draft.clarificationQuestions && draft.clarificationQuestions.length > 0
              ? "draft_with_placeholders"
              : "draft_ready",
        },
      };
    } catch (err) {
      return { ok: false, error: `起草失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// render_document — 渲染最终交付物
// ─────────────────────────────────────────────

export const renderDocument: AgentTool = {
  definition: {
    name: "render_document",
    description:
      "将草稿渲染为最终交付物（Word 文档等）。可指定 task_id；若省略，则默认使用最近一份草稿。若律师已在当前对话中明确同意导出，可传 approve=true 先批准再渲染。",
    category: "draft",
    parameters: {
      task_id: { type: "string", description: "任务 ID；不传时默认使用最近一份草稿" },
      approve: { type: "boolean", description: "律师已明确同意导出时设为 true，先批准草稿再渲染" },
      approval_note: { type: "string", description: "审批备注（可选）" },
      bypass_acceptance_gate: {
        type: "boolean",
        description:
          "默认 false：草稿未通过 Deliverable-First 验收门禁时拒绝渲染。仅在律师已确认草稿完整、知道接受占位符的前提下设为 true。",
      },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const taskId =
        params.task_id === undefined
          ? resolveLatestDraftTaskId(ctx.workspaceDir)
          : asNonEmptyString(params.task_id, "task_id", 128);
      const approvalNote = asOptionalString(params.approval_note, "approval_note", 500);
      const shouldApprove = params.approve === true;
      const bypassGate = params.bypass_acceptance_gate === true;
      if (!taskId) {
        return {
          ok: false,
          error: "当前没有可渲染的草稿。请先使用 draft_document 或 execute_workflow 生成草稿。",
        };
      }
      const draft = engine.getDraft(taskId);

      if (!draft) {
        return {
          ok: false,
          error: `找不到任务 ${taskId} 的草稿。请先使用 draft_document 或 execute_workflow 生成草稿。`,
        };
      }

      let approvedDraft = draft;
      if (approvedDraft.reviewStatus !== "approved" && shouldApprove) {
        approvedDraft = await engine.review(approvedDraft, {
          actorId: ctx.actorId,
          status: "approved",
          note: approvalNote ?? "律师在当前对话中明确同意导出最终文书。",
        });
      }

      if (approvedDraft.reviewStatus !== "approved") {
        return {
          ok: false,
          error: `草稿尚未通过审核（当前状态：${approvedDraft.reviewStatus}）。渲染最终文档前需要律师审批；若律师已明确同意导出，请使用 approve=true 重新调用。`,
          pendingApproval: true,
        };
      }

      // Acceptance Gate (Deliverable-First Architecture):
      // 在调用渲染管线前先跑验收；未通过时默认拒绝渲染，把 report 挂到 detail 让 agent 把清单原文展示给律师。
      // 当律师明确知情接受占位符时可传 bypass_acceptance_gate=true 走旁路。
      const acceptance = validateDraftAgainstSpec(approvedDraft);
      if (!acceptance.ready && !bypassGate) {
        return {
          ok: false,
          error: `草稿未通过验收门禁（blockers=${acceptance.blockerCount}, placeholders=${acceptance.placeholderCount}）。请先补齐缺失内容再渲染；若律师已确认接受占位符，可使用 bypass_acceptance_gate=true 重新调用。`,
          pendingApproval: true,
          data: {
            taskId: approvedDraft.taskId,
            title: approvedDraft.title,
            acceptance,
          },
        };
      }

      const result = await engine.render(approvedDraft);
      if (result.ok) {
        return {
          ok: true,
          data: {
            taskId: approvedDraft.taskId,
            title: approvedDraft.title,
            outputPath: result.outputPath,
            acceptance,
            message: `文书已渲染完成：${result.outputPath}`,
          },
        };
      }
      return { ok: false, error: result.error ?? "渲染失败" };
    } catch (err) {
      return { ok: false, error: `渲染失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// execute_workflow — 一键完整流程
// ─────────────────────────────────────────────

export const executeWorkflow: AgentTool = {
  definition: {
    name: "execute_workflow",
    description:
      '自主执行完整的法律工作流程：解析指令 → 检索法规和案例 → 生成文书草稿 → 自动审核（低风险）或标记等待律师审批（高风险）。**在需求已对齐的前提下**，文书类任务应优先调用本工具而非只写摘要。若上次因检索为空等原因中断，可传 **existing_task_id** + **restart_from: "research"** 跳过重新规划、重试检索及后续步骤。返回 data.citationIntegrity；失败时 data 可能含 recoverable / existingTaskId。',
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "律师的工作指令", required: true },
      title: { type: "string", description: "文书标题（可选）" },
      audience: { type: "string", description: "目标受众（内部/客户/对方/法院）" },
      matter_id: { type: "string", description: "关联案件 ID" },
      template_id: {
        type: "string",
        description:
          "模板 ID（如 word/legal-memo-default、ppt/client-brief-default、upload/firm-brief）",
      },
      auto_approve: {
        type: "boolean",
        description: "低风险任务是否自动批准草稿（默认 true）。高风险任务始终需要律师审批。",
      },
      force_render: {
        type: "boolean",
        description: "仅用于 demo：中/高风险也自动批准并渲染，输出 .docx 路径。",
      },
      existing_task_id: {
        type: "string",
        description:
          "续跑：已有引擎任务 ID（workspace/tasks/<id>.json）。与 restart_from 联用可跳过重新 plan，直接重试检索及后续步骤（如上次检索为空或失败）。",
      },
      restart_from: {
        type: "string",
        description: '续跑起点：传 "research" 时跳过 plan，沿用该任务已持久化的意图。',
        enum: ["research"],
      },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    const steps: string[] = [];
    try {
      const engine = getEngine(ctx);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const title = asOptionalString(params.title, "title", MAX_TITLE_LENGTH);
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const templateId = resolveTemplateId(params.template_id);
      const autoApprove = params.auto_approve !== false;
      const forceRender = params.force_render === true;
      const existingTaskIdRaw =
        typeof params.existing_task_id === "string" ? params.existing_task_id.trim() : "";
      const restartFrom =
        typeof params.restart_from === "string" ? params.restart_from.trim().toLowerCase() : "";

      let intent: TaskIntent;

      if (existingTaskIdRaw) {
        if (restartFrom !== "research") {
          return {
            ok: false,
            error:
              '续跑时必须同时传入 restart_from: "research"（当前仅支持从检索阶段重试后续管线）。',
            data: { stepsCompleted: steps, recoverable: false },
          };
        }
        const rec = readTaskRecord(ctx.workspaceDir, existingTaskIdRaw);
        if (!rec) {
          return {
            ok: false,
            error: `未找到任务 ${existingTaskIdRaw}。请确认 taskId，或去掉续跑参数重新规划。`,
            data: { stepsCompleted: steps, recoverable: false },
          };
        }
        intent = taskIntentFromRecordOnly(rec);
        const mid = resolveMatterId(params.matter_id, matterId ?? intent.matterId);
        if (mid) {
          intent = { ...intent, matterId: mid };
        }
        if (templateId) {
          intent = { ...intent, templateId };
        }
        if (audience) {
          intent = { ...intent, audience };
        }
        steps.push(
          `续跑任务 ${existingTaskIdRaw}：已跳过重新规划，沿用已持久化意图（${intent.summary.slice(0, 80)}…）。`,
        );
      } else {
        // Step 1: Plan
        steps.push("正在解析指令...");
        intent = await engine.planAsync(instruction, {
          audience,
          matterId,
        });
        steps.push(`任务计划完成：${intent.summary}（风险：${intent.riskLevel}）`);
      }

      // Step 2: Confirm (if needed)
      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, {
          actorId: ctx.actorId,
          note: "Agent 工作流自动确认",
        });
        steps.push("高风险任务已确认，进入检索阶段");
      }

      // Step 3: Research
      steps.push("正在检索法规和案例...");
      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          steps.push("检索结果为空，但该任务属于完整文书起草，继续生成带待补充项的正式草稿。");
        } else {
          return {
            ok: false,
            error: "检索返回空结果，工作流停止。请检查模型配置或先补充案件资料。",
            data: {
              stepsCompleted: steps,
              recoverable: true,
              existingTaskId: intent.taskId,
              restartFrom: "research",
              hint: '修正后可再次调用本工具：existing_task_id 填上述 taskId，restart_from 填 "research"，instruction 可沿用原句。',
            },
          };
        }
      }
      steps.push(
        `检索完成：${bundle.sources.length} 条来源，${bundle.claims.length} 条结论，${bundle.riskFlags.length} 条风险标记`,
      );

      // Step 4: Draft
      steps.push("正在生成文书草稿...");
      const draft = await engine.draftAsync(intent, bundle, {
        title,
        templateId,
      });
      steps.push(`草稿生成完成：《${draft.title}》，共 ${draft.sections.length} 个章节`);
      const citationIntegrity = validateDraftCitationsAgainstBundle(draft, bundle);
      if (!citationIntegrity.ok) {
        steps.push(
          `引用校验：有 ${citationIntegrity.missingSourceIds.length} 个来源 ID 不在本次检索结果中（${citationIntegrity.missingSourceIds.join(", ")}），请人工核对。`,
        );
      }

      // Step 5: Auto-review or mark for approval (or force_render for demo)
      let finalStatus = "awaiting_review";
      const shouldAutoRender = (intent.riskLevel === "low" && autoApprove) || forceRender;
      if (shouldAutoRender) {
        await engine.review(draft, {
          actorId: ctx.actorId,
          status: "approved",
          note: forceRender ? "Demo 模式：自动批准并渲染。" : "低风险任务，Agent 自动审核通过。",
        });
        steps.push(forceRender ? "Demo：已自动批准并渲染。" : "低风险任务，已自动审核通过。");

        // Step 6: Render
        steps.push("正在渲染最终文档...");
        const result = await engine.render(draft);
        if (result.ok) {
          finalStatus = "delivered";
          steps.push(`交付完成：${result.outputPath}`);
          draft.outputPath = result.outputPath;
        } else {
          finalStatus = "render_failed";
          steps.push(`渲染失败：${result.error}`);
        }
      } else {
        finalStatus = "awaiting_lawyer_review";
        steps.push(
          `⚠ ${intent.riskLevel === "high" ? "高" : "中"}风险任务，草稿已生成，等待律师审批后渲染。`,
        );
      }

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          title: draft.title,
          kind: intent.kind,
          deliverableType: intent.deliverableType,
          riskLevel: intent.riskLevel,
          output: draft.output,
          matterId: intent.matterId,
          status: finalStatus,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => s.heading),
          riskFlags: bundle.riskFlags,
          missingItems: bundle.missingItems,
          claimsCount: bundle.claims.length,
          sourcesCount: bundle.sources.length,
          outputPath: draft.outputPath,
          steps,
          citationIntegrity,
          acceptanceCriteria: draft.acceptanceCriteria,
          clarificationQuestions: draft.clarificationQuestions,
          deliveryReadiness:
            draft.clarificationQuestions && draft.clarificationQuestions.length > 0
              ? "draft_with_placeholders"
              : "draft_ready",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `工作流执行失败: ${err instanceof Error ? err.message : String(err)}`,
        data: { stepsCompleted: steps },
      };
    }
  },
};

export const registerTemplate: AgentTool = {
  definition: {
    name: "register_template",
    description:
      "注册用户上传的 Word/PPT 模板，支持占位符映射、版本递增、启用状态管理。用于律所模板库维护。",
    category: "system",
    parameters: {
      id: { type: "string", description: "模板 ID，必须以 upload/ 开头", required: true },
      format: { type: "string", description: "模板格式：docx 或 pptx", required: true },
      label: { type: "string", description: "模板显示名称", required: true },
      source_path: { type: "string", description: "模板文件本地路径", required: true },
      enabled: { type: "boolean", description: "是否启用模板（默认 true）" },
      placeholder_map_json: {
        type: "string",
        description: '占位符映射 JSON 字符串，例如 {"case_title":"title"}',
      },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    try {
      const id = asNonEmptyString(params.id, "id", MAX_TEMPLATE_ID_LENGTH);
      const label = asNonEmptyString(params.label, "label", 100);
      const sourcePath = asNonEmptyString(params.source_path, "source_path", 1000);
      const formatRaw = asNonEmptyString(params.format, "format", 8).toLowerCase();
      if (formatRaw !== "docx" && formatRaw !== "pptx") {
        throw new Error("format 必须为 docx 或 pptx");
      }
      let placeholderMap: Record<string, string> = {};
      if (typeof params.placeholder_map_json === "string" && params.placeholder_map_json.trim()) {
        const parsed = JSON.parse(params.placeholder_map_json) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("placeholder_map_json 必须是对象 JSON");
        }
        placeholderMap = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]),
        );
      }
      const record = await registerUploadedTemplate({
        workspaceDir: ctx.workspaceDir,
        id,
        format: formatRaw,
        label,
        sourcePath,
        enabled: params.enabled !== false,
        placeholderMap,
      });
      return {
        ok: true,
        data: {
          id: record.id,
          format: record.format,
          label: record.label,
          version: record.version,
          enabled: record.enabled,
          uploadedAt: record.uploadedAt,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `模板注册失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const listTemplates: AgentTool = {
  definition: {
    name: "list_templates",
    description: "查看内置模板和已上传模板，支持更新上传模板启用状态。用于任务前检查模板是否可用。",
    category: "system",
    parameters: {
      set_enabled_for_id: { type: "string", description: "可选：要变更启用状态的上传模板 ID" },
      enabled: { type: "boolean", description: "配合 set_enabled_for_id 使用" },
    },
  },
  async execute(params, ctx) {
    try {
      if (typeof params.set_enabled_for_id === "string" && typeof params.enabled === "boolean") {
        await setUploadedTemplateEnabled({
          workspaceDir: ctx.workspaceDir,
          id: params.set_enabled_for_id.trim(),
          enabled: params.enabled,
        });
      }
      const builtIn = listBuiltInTemplates();
      const uploaded = await listUploadedTemplates(ctx.workspaceDir);
      return {
        ok: true,
        data: {
          builtIn,
          uploaded,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `读取模板失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

/**
 * 注册所有 engine-bridge 工具到 registry
 */
export const engineTools: AgentTool[] = [
  planTask,
  researchTask,
  draftDocument,
  renderDocument,
  executeWorkflow,
  registerTemplate,
  listTemplates,
];
