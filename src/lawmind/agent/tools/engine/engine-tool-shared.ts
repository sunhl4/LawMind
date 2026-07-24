import { listDrafts } from "../../../drafts/index.js";
/**
 * Engine tool shared helpers and engine factory.
 */
import { createLawMindEngine } from "../../../engine/factory.js";
import type { LawMindEngineConfig } from "../../../engine/types.js";
import { createAuthorityAdapterFromEnv } from "../../../retrieval/authority-adapter.js";
import { createWorkspaceAdapter } from "../../../retrieval/index.js";
import type { RetrievalAdapter } from "../../../retrieval/index.js";
import { createOpenAICompatibleAdapters } from "../../../retrieval/openai-compatible.js";
import {
  createLexEdgeAdapterFromEnv,
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../../retrieval/providers.js";
import type { AgentContext, ToolCallResult } from "../../types.js";

export const MAX_INSTRUCTION_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_AUDIENCE_LENGTH = 100;
export const MAX_TEMPLATE_ID_LENGTH = 96;
const MATTER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;
const TEMPLATE_ID_RE = /^(word|ppt|upload)\/[a-zA-Z0-9][a-zA-Z0-9._-]{1,95}$/;

export function asNonEmptyString(value: unknown, field: string, maxLength: number): string {
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

export function asOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return asNonEmptyString(value, field, maxLength);
}

export function resolveMatterId(raw: unknown, fallback?: string): string | undefined {
  const candidate = typeof raw === "string" ? raw.trim() : fallback;
  if (!candidate) {
    return undefined;
  }
  if (!MATTER_ID_RE.test(candidate)) {
    throw new Error("matter_id 格式不合法，只允许字母/数字/._-");
  }
  return candidate;
}

export function resolveTemplateId(raw: unknown): string | undefined {
  const candidate = asOptionalString(raw, "template_id", MAX_TEMPLATE_ID_LENGTH);
  if (!candidate) {
    return undefined;
  }
  if (!TEMPLATE_ID_RE.test(candidate)) {
    throw new Error("template_id 格式不合法，示例：word/legal-memo-default 或 upload/firm-brief");
  }
  return candidate;
}

export function resolveLatestDraftTaskId(workspaceDir: string): string | undefined {
  const drafts = listDrafts(workspaceDir);
  const preferred = drafts.find((draft) => !draft.outputPath) ?? drafts[0];
  return preferred?.taskId;
}

/** 未显式传 task_id 时：工作台关联草稿优先，否则最近草稿 */
export function resolveDefaultRenderTaskId(
  ctx: AgentContext,
  workspaceDir: string,
): string | undefined {
  const linked = typeof ctx.linkedTaskId === "string" ? ctx.linkedTaskId.trim() : "";
  if (linked && listDrafts(workspaceDir).some((d) => d.taskId === linked)) {
    return linked;
  }
  return resolveLatestDraftTaskId(workspaceDir);
}

export function canDraftWithoutResearch(intent: {
  kind: string;
  deliverableType?: string;
}): boolean {
  return intent.kind === "draft.word" && Boolean(intent.deliverableType);
}

export function pushWorkflowProgress(ctx: AgentContext, steps: string[], message: string): void {
  steps.push(message);
  ctx.emitToolProgress?.(message);
}

/**
 * 同一 turn 内已有工具返回 clarificationQuestions 时，阻止写/导出管线。
 * 不拦截 research_task：澄清期间允许先检索事实。
 */
export function blockHeavyPipelineIfClarificationPending(ctx: AgentContext): ToolCallResult | null {
  if (!ctx.clarificationBlockingHeavyTools) {
    return null;
  }
  return {
    ok: false,
    error:
      "仍有待澄清事项：请先请律师回答上一轮列出的问题后，再执行起草、完整工作流或渲染。澄清期间仍可只读检索与 analyze。可直接在对话中补充要点。",
    data: {
      gateDecision: {
        gate: "clarification_gate",
        decision: "block",
        reason: "clarification pending",
      },
    },
  };
}

/**
 * 通用模型连接信息（与桌面 `buildAgentConfig` / 向导写入的变量对齐）。
 */
export function parseRetrievalTimeoutMs(): number {
  const raw =
    process.env.LAWMIND_RETRIEVAL_TIMEOUT_MS?.trim() ||
    process.env.LAWMIND_AGENT_TIMEOUT_MS?.trim() ||
    "";
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return 120_000;
}

export function resolveGeneralOpenAICompatibleFromEnv(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
} | null {
  const timeoutMs = parseRetrievalTimeoutMs();
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
    return { baseUrl, apiKey, model, timeoutMs };
  }

  const qwenKey = process.env.LAWMIND_QWEN_API_KEY?.trim();
  const qwenModel = process.env.LAWMIND_QWEN_MODEL?.trim();
  if (qwenKey && qwenModel) {
    return {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: qwenKey,
      model: qwenModel,
      timeoutMs,
    };
  }

  return null;
}

/**
 * 根据环境变量创建 retrieval adapters。
 * - 默认 `LAWMIND_RETRIEVAL_MODE=single`：通用与法律检索共用同一 OpenAI-compatible 端点。
 * - `dual`：通用用 LAWMIND_AGENT_* / QWEN_*，法律用 CHATLAW / LAWGPT / PARTNER 等（见 providers.ts）；未配置法律端点时回退为通用模型做法务检索。
 */
export function buildAdaptersFromEnv(workspaceDir: string): RetrievalAdapter[] {
  const adapters: RetrievalAdapter[] = [
    createWorkspaceAdapter(workspaceDir),
    createAuthorityAdapterFromEnv(),
  ];

  // C11: LexEdge when LAWMIND_LEXEDGE_ENDPOINT is set (no-op otherwise).
  adapters.push(...createLexEdgeAdapterFromEnv());

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

export function getEngine(ctx: AgentContext) {
  const adapters = buildAdaptersFromEnv(ctx.workspaceDir);
  const config: LawMindEngineConfig = {
    workspaceDir: ctx.workspaceDir,
    adapters,
    assistantId: ctx.assistantId,
  };
  return createLawMindEngine(config);
}
