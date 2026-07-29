/**
 * Tool execution pipeline — 把 agent runtime 里散落的工具调用前置规则
 * （budget / role allowlist / approval / clarification gate / argument schema /
 * timeout / audit / execute）抽成可组合中间件。
 *
 * 设计：
 *   - 每个中间件按 koa/expressjs 风格 `(call, next) => Promise<ToolCallResult>` 串联。
 *   - 默认顺序由 `buildDefaultToolPipeline()` 给出；测试可替换任意一段。
 *   - 中间件不会改变 `tool.execute(args, ctx)` 的最终返回类型（始终是 `ToolCallResult`）。
 *
 * 与历史 runtime.ts 行为对齐：
 *   - argSchemaMiddleware 复用 `validateToolArguments`。
 *   - approvalMiddleware 复用 `toolRequiresExplicitApproval` + `__approved` 字段。
 *   - clarificationGateMiddleware 在 `ctx.clarificationBlockingHeavyTools` 为真时拒绝写/导出工具（仍允许 research）。
 *   - budgetMiddleware 在调用前检查 `usedToolCalls >= maxToolCalls`。
 *   - timeoutMiddleware 用 `Promise.race` 包装。
 *   - auditMiddleware 在 next() 后写入审计（保证记录的是真实结果）。
 */

import {
  toolRequiresExplicitApproval,
  toolRequiresSubprocessSandbox,
} from "../agent/dangerous-tool-policy.js";
import { normalizeToolCallArguments } from "../agent/runtime-tool-arg-normalize.js";
import {
  stripUnknownToolArguments,
  validateToolArguments,
} from "../agent/runtime-tool-validation.js";
import type { AgentContext, AgentTool, ToolCallResult, ToolDefinition } from "../agent/types.js";
import { emit } from "../audit/index.js";
import { runToolInSubprocessSandbox } from "./tool-sandbox.js";

/**
 * Write/export tools blocked while clarification is pending.
 * research_task and other read/analyze tools stay allowed so the model can
 * gather facts before the lawyer answers.
 */
const WRITE_HEAVY_TOOL_NAMES = new Set<string>([
  "draft_document",
  "update_draft",
  "execute_workflow",
  "render_document",
]);

export type ToolCallContext = {
  /** 工具调用 ID（来自模型 tool_calls[i].id） */
  toolCallId: string;
  /** 工具名 */
  toolName: string;
  /** 已 parse 的参数（含可选 `__approved`） */
  args: Record<string, unknown>;
  /** 注册中心查询结果（可能为 undefined → unknown tool） */
  tool: AgentTool | undefined;
  /** Agent runtime 上下文 */
  ctx: AgentContext;
  /** 中间件配置（来自 AgentConfig） */
  policy: ToolPolicyConfig;
  /** 当前 turn 的诊断字段 */
  turn: { turnId: string };
};

export type ToolPolicyConfig = {
  /** 当前 turn 已经执行的工具调用次数（包含本次）；用于 budget 中间件 */
  usedToolCalls: number;
  /** 当前 turn 工具调用上限 */
  maxToolCalls: number;
  /** 单次工具执行超时（ms） */
  toolTimeoutMs: number;
  /** Edition：strict 模式下危险工具一律需要 `__approved` */
  strictDangerousToolApproval: boolean;
  /** 开发态：是否允许默认未标记 `requiresApproval` 的工具直接执行 */
  allowDangerousToolsWithoutApproval: boolean;
  /** Role allowlist；undefined 表示不限制 */
  allowedToolNames?: string[];
  /** W7：当前 Role.id（仅审计/诊断用，pipeline 通过 allowedToolNames + riskCeiling 决策） */
  roleId?: string;
  /** W7：Role.riskCeiling；高风险工具在此模型下默认要求审批 */
  riskCeiling?: "low" | "medium" | "high";
  /** P2：高风险工具走子进程沙箱（policy `toolSandbox` 或 `LAWMIND_TOOL_SANDBOX=1`） */
  toolSandboxEnabled?: boolean;
  /** 审计 actorId（写入 tool_call 事件） */
  actorId: string;
  /** 工作区 audit 目录，写入 tool_call 用 */
  auditDir: string;
  /** 关联的 sessionId / matterId / assistantId（仅审计 detail 用） */
  sessionMatterId?: string;
  sessionAssistantId?: string;
};

export type ToolMiddleware = (
  call: ToolCallContext,
  next: () => Promise<ToolCallResult>,
) => Promise<ToolCallResult>;

/** 把多段中间件按顺序合成一个 runner。 */
export function composeToolPipeline(
  middlewares: ToolMiddleware[],
): (call: ToolCallContext) => Promise<ToolCallResult> {
  return async function run(call) {
    let i = -1;
    async function dispatch(idx: number): Promise<ToolCallResult> {
      if (idx <= i) {
        throw new Error("next() called multiple times in same middleware");
      }
      i = idx;
      const fn = middlewares[idx];
      if (!fn) {
        return { ok: false, error: "tool pipeline exhausted without execute middleware" };
      }
      return fn(call, () => dispatch(idx + 1));
    }
    return dispatch(0);
  };
}

// ─────────────────────────────────────────────
// 中间件实现
// ─────────────────────────────────────────────

/** 工具不存在 → 立即拒绝，跳过后续中间件。 */
export const unknownToolMiddleware: ToolMiddleware = async (call, next) => {
  if (!call.tool) {
    return { ok: false, error: `Unknown tool: ${call.toolName}` };
  }
  return next();
};

/** 当前 turn 工具预算耗尽 → 立即拒绝。 */
export const budgetMiddleware: ToolMiddleware = async (call, next) => {
  if (call.policy.usedToolCalls > call.policy.maxToolCalls) {
    return {
      ok: false,
      error: `Tool budget exhausted (used ${call.policy.usedToolCalls} > max ${call.policy.maxToolCalls})`,
    };
  }
  return next();
};

/** 需绑定案件的文件/检索工具；无 matterId（上下文或参数）时拒绝。 */
export const MATTER_SCOPED_TOOL_NAMES = new Set<string>([
  "search_matter",
  "read_case_file",
  "add_case_note",
  "get_matter_summary",
]);

export const matterScopeMiddleware: ToolMiddleware = async (call, next) => {
  if (!MATTER_SCOPED_TOOL_NAMES.has(call.toolName)) {
    return next();
  }
  const fromArgs = typeof call.args.matter_id === "string" ? call.args.matter_id.trim() : "";
  const matterId = fromArgs || call.ctx.matterId?.trim() || "";
  if (!matterId) {
    return {
      ok: false,
      error: "此工具需绑定案件：请在工作台选中案件，或在对话中指定案件后再继续。",
    };
  }
  return next();
};

/** Role / preset allowlist；不在白名单 → 拒绝。 */
export const roleAllowlistMiddleware: ToolMiddleware = async (call, next) => {
  const allow = call.policy.allowedToolNames;
  if (allow && allow.length > 0 && !allow.includes(call.toolName)) {
    return {
      ok: false,
      error: `Tool ${call.toolName} not allowed for current role.`,
    };
  }
  return next();
};

/** Clarification gate：待澄清时禁止起草/工作流/渲染；允许只读与 research_task。 */
export const clarificationGateMiddleware: ToolMiddleware = async (call, next) => {
  if (call.ctx.clarificationBlockingHeavyTools && WRITE_HEAVY_TOOL_NAMES.has(call.toolName)) {
    return {
      ok: false,
      error:
        "仍有待澄清事项：请先请律师回答上一轮列出的问题后，再执行起草、完整工作流或渲染。澄清期间仍可只读检索与 analyze。",
    };
  }
  return next();
};

/** 危险工具未 `__approved` → 拒绝（带 pendingApproval=true）。 */
export const approvalMiddleware: ToolMiddleware = async (call, next) => {
  if (!call.tool) {
    return next();
  }
  const requires = toolRequiresExplicitApproval({
    toolName: call.toolName,
    definition: call.tool.definition,
    allowDangerousToolsWithoutApproval: call.policy.allowDangerousToolsWithoutApproval,
    strictDangerousToolApproval: call.policy.strictDangerousToolApproval,
  });
  if (requires && call.args.__approved !== true) {
    return {
      ok: false,
      error: `Tool ${call.toolName} requires lawyer approval. Retry with "__approved": true after explicit confirmation.`,
      pendingApproval: true,
    };
  }
  return next();
};

/** 参数归一化（别名、linkedTaskId 缺省等），在校验前执行。 */
export const argNormalizeMiddleware: ToolMiddleware = async (call, next) => {
  normalizeToolCallArguments(call);
  return next();
};

/** 参数 schema 校验：未知键剥离（不硬失败），再校验 required/type/enum。 */
export const argSchemaMiddleware: ToolMiddleware = async (call, next) => {
  if (!call.tool) {
    return next();
  }
  const stripped = stripUnknownToolArguments(call.tool.definition, call.args);
  const validationError = validateToolArguments(call.tool.definition, call.args);
  if (validationError) {
    return { ok: false, error: `Invalid arguments for ${call.toolName}: ${validationError}` };
  }
  const result = await next();
  if (stripped.length > 0 && result.ok) {
    const note = `已忽略未知参数：${stripped.join(", ")}（不影响执行）`;
    const data =
      result.data && typeof result.data === "object"
        ? { ...(result.data as Record<string, unknown>), argNote: note }
        : { argNote: note };
    return { ...result, data };
  }
  return result;
};

/**
 * 单次工具执行超时（默认包在 execute 外层）。
 *
 * 用 AbortController + Promise.race：超时时既立即向调用方返回超时错误，
 * 又通过 `controller.abort()` 翻转 `ctx.abortSignal`，让读取该 signal 的工具
 * （fetch / 模型调用 / 子进程）取消底层工作，而不是让它在超时后继续跑到完成。
 */
export const timeoutMiddleware: ToolMiddleware = async (call, next) => {
  const controller = new AbortController();
  const prev = call.ctx.abortSignal;
  call.ctx.abortSignal = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Tool ${call.toolName} timed out after ${call.policy.toolTimeoutMs}ms`));
        }, call.policy.toolTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    call.ctx.abortSignal = prev;
  }
};

/** 审计：next() 之后写一条 tool_call 事件（best-effort）。 */
export const auditMiddleware: ToolMiddleware = async (call, next) => {
  let result: ToolCallResult;
  try {
    result = await next();
  } catch (err) {
    result = {
      ok: false,
      error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const payload = {
    tool: call.toolName,
    ok: result.ok,
    matterId: call.policy.sessionMatterId ?? null,
    assistantId: call.policy.sessionAssistantId ?? null,
    roleId: call.policy.roleId ?? null,
    error: result.error ?? null,
  };
  void emit(call.policy.auditDir, {
    kind: "tool_call",
    actor: "model",
    actorId: call.policy.actorId,
    detail: `${JSON.stringify(payload)} | tool=${call.toolName} ok=${result.ok}${result.error ? ` error=${result.error}` : ""}`,
    taskId: call.turn.turnId,
  });
  return result;
};

/** P2：高风险工具在子进程执行（POC）；未启用时透传。 */
export const subprocessSandboxMiddleware: ToolMiddleware = async (call, next) => {
  if (
    !call.policy.toolSandboxEnabled ||
    !toolRequiresSubprocessSandbox(call.toolName) ||
    !call.tool
  ) {
    return next();
  }
  return runToolInSubprocessSandbox(call);
};

/** 终态：执行 tool.execute()。 */
export const executeMiddleware: ToolMiddleware = async (call) => {
  if (!call.tool) {
    return { ok: false, error: `Unknown tool: ${call.toolName}` };
  }
  try {
    return await call.tool.execute(call.args, call.ctx);
  } catch (err) {
    return {
      ok: false,
      error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

/** 默认中间件链。 */
export function buildDefaultToolPipeline(): ToolMiddleware[] {
  return [
    unknownToolMiddleware,
    budgetMiddleware,
    roleAllowlistMiddleware,
    matterScopeMiddleware,
    clarificationGateMiddleware,
    approvalMiddleware,
    argNormalizeMiddleware,
    argSchemaMiddleware,
    auditMiddleware,
    timeoutMiddleware,
    subprocessSandboxMiddleware,
    executeMiddleware,
  ];
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

/** 公共 ToolDefinition export，便于测试构造 stub。 */
export type { ToolDefinition };
