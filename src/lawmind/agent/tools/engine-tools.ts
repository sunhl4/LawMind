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

import { createLawMindEngine, type LawMindEngineConfig } from "../../index.js";
import { createWorkspaceAdapter } from "../../retrieval/index.js";
import type { RetrievalAdapter } from "../../retrieval/index.js";
import { createOpenAICompatibleAdapters } from "../../retrieval/openai-compatible.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../retrieval/providers.js";
import type { AgentContext, AgentTool } from "../types.js";

const MAX_INSTRUCTION_LENGTH = 4000;
const MAX_TITLE_LENGTH = 200;
const MAX_AUDIENCE_LENGTH = 100;
const MATTER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;

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
          summary: intent.summary,
          riskLevel: intent.riskLevel,
          output: intent.output,
          requiresConfirmation: intent.requiresConfirmation,
          models: intent.models,
          matterId: intent.matterId,
          templateId: intent.templateId,
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
      "基于检索结果生成文书草稿。会产出结构化的文书（包含标题、章节、引用等），并自动持久化到工作区。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "原始工作指令", required: true },
      title: { type: "string", description: "文书标题（可选，自动推断）" },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
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
      const title = asOptionalString(params.title, "title", MAX_TITLE_LENGTH);
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });

      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, { actorId: ctx.actorId });
      }

      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        return {
          ok: false,
          error: "检索返回空结果，无法生成可靠草稿。请补充信息后重试。",
        };
      }
      const draft = await engine.draftAsync(intent, bundle, {
        title,
      });

      return {
        ok: true,
        data: {
          taskId: draft.taskId,
          title: draft.title,
          output: draft.output,
          templateId: draft.templateId,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => ({
            heading: s.heading,
            bodyPreview: s.body.slice(0, 100),
            citationsCount: s.citations?.length ?? 0,
          })),
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
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
      "将已审核通过的草稿渲染为最终交付物（Word 文档等）。草稿必须已经通过审核（approved）才能渲染。",
    category: "draft",
    parameters: {
      task_id: { type: "string", description: "任务 ID", required: true },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    try {
      const engine = getEngine(ctx);
      const taskId = asNonEmptyString(params.task_id, "task_id", 128);
      const draft = engine.getDraft(taskId);

      if (!draft) {
        return {
          ok: false,
          error: `找不到任务 ${taskId} 的草稿。请先使用 draft_document 或 execute_workflow 生成草稿。`,
        };
      }

      if (draft.reviewStatus !== "approved") {
        return {
          ok: false,
          error: `草稿尚未通过审核（当前状态：${draft.reviewStatus}）。渲染最终文档前需要律师审批。`,
          pendingApproval: true,
        };
      }

      const result = await engine.render(draft);
      if (result.ok) {
        return {
          ok: true,
          data: {
            taskId: draft.taskId,
            title: draft.title,
            outputPath: result.outputPath,
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
      "自主执行完整的法律工作流程：解析指令 → 检索法规和案例 → 生成文书草稿 → 自动审核（低风险）或标记等待律师审批（高风险）。这是最核心的工具——收到律师指令后调用它来完成整个任务。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "律师的工作指令", required: true },
      title: { type: "string", description: "文书标题（可选）" },
      audience: { type: "string", description: "目标受众（内部/客户/对方/法院）" },
      matter_id: { type: "string", description: "关联案件 ID" },
      auto_approve: {
        type: "boolean",
        description: "低风险任务是否自动批准草稿（默认 true）。高风险任务始终需要律师审批。",
      },
      force_render: {
        type: "boolean",
        description: "仅用于 demo：中/高风险也自动批准并渲染，输出 .docx 路径。",
      },
    },
  },
  async execute(params, ctx) {
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
      const autoApprove = params.auto_approve !== false;
      const forceRender = params.force_render === true;
      // Step 1: Plan
      steps.push("正在解析指令...");
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });
      steps.push(`任务计划完成：${intent.summary}（风险：${intent.riskLevel}）`);

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
        return {
          ok: false,
          error: "检索返回空结果，工作流停止。请检查模型配置或先补充案件资料。",
          data: { stepsCompleted: steps },
        };
      }
      steps.push(
        `检索完成：${bundle.sources.length} 条来源，${bundle.claims.length} 条结论，${bundle.riskFlags.length} 条风险标记`,
      );

      // Step 4: Draft
      steps.push("正在生成文书草稿...");
      const draft = await engine.draftAsync(intent, bundle, {
        title,
      });
      steps.push(`草稿生成完成：《${draft.title}》，共 ${draft.sections.length} 个章节`);

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

/**
 * 注册所有 engine-bridge 工具到 registry
 */
export const engineTools: AgentTool[] = [
  planTask,
  researchTask,
  draftDocument,
  renderDocument,
  executeWorkflow,
];
