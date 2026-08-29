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
import { combineAbortSignals } from "../agent/runtime-model-call.js";
import { normalizeToolCallArguments } from "../agent/runtime-tool-arg-normalize.js";
import {
  stripUnknownToolArguments,
  validateToolArguments,
} from "../agent/runtime-tool-validation.js";
import { MATTER_SCOPE_REQUIRED } from "../agent/tool-name-sets.js";
import { resolveToolRiskLevel } from "../agent/tools/governance.js";
import type { AgentContext, AgentTool, ToolCallResult, ToolDefinition } from "../agent/types.js";
import { emit } from "../audit/index.js";
import { toolRequiresLawyerPause } from "../platform/lawyer-outbound-decision.js";
import { legalVerifyMiddleware } from "./legal-verify-middleware.js";
import { runToolInSubprocessSandbox } from "./tool-sandbox.js";

/**
 * Write/export tools blocked while clarification is pending.
 * research_task and other read/analyze tools stay allowed so the model can
 * gather facts before the lawyer answers.
 * 覆盖全部「产出/交付面」写工具：改稿、tracked 导出、写文件、待发/发信也在内，
 * 避免「澄清未决却先交付」。
 */
const WRITE_HEAVY_TOOL_NAMES = new Set<string>([
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "execute_workflow",
  "render_document",
  "render_tracked_draft",
  "write_document",
  "prepare_outbound_mail",
  "send_email",
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
  /** Extra lawyer-facing reason when a tool is outside the allowlist. */
  allowlistDenyHint?: string;
  /** W7：当前 Role.id（仅审计/诊断用，pipeline 通过 allowedToolNames + riskCeiling 决策） */
  roleId?: string;
  /** W7：Role.riskCeiling；高风险工具在此模型下默认要求审批 */
  riskCeiling?: "low" | "medium" | "high";
  /** P2：高风险工具走子进程沙箱（policy `toolSandbox` 或 `LAWMIND_TOOL_SANDBOX=1`） */
  toolSandboxEnabled?: boolean;
  /**
   * Counts of tool names already executed this turn **before** the current call.
   * Used by discoveryLoopMiddleware to stop search/browse death spirals.
   */
  toolNameCallCounts?: Record<string, number>;
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
    return { ok: false, error: `未知工具：${call.toolName}。该工具未注册，请核对请求。` };
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

/**
 * Browse/search tools that commonly loop when a concrete path is already known
 * (mail-contract attachments, pinned files). Cap repeats per turn.
 * Kept low so free chat cannot stack into a 25–31 step death spiral.
 */
export const DISCOVERY_LOOP_TOOL_LIMITS: Readonly<Record<string, number>> = {
  search_workspace: 1,
  search_matter: 1,
  read_project_file: 1,
  list_templates: 1,
  get_matter_summary: 1,
  list_matters: 1,
  analyze_document: 1,
  list_tasks: 1,
  list_drafts: 1,
  list_mail_inbox: 1,
  list_mail_attachments: 1,
};

/** Sum of discovery-tool calls per turn (all capped tools combined). */
export const DISCOVERY_LOOP_TOTAL_CAP = 4;

const DISCOVERY_STOP_HINT_MAIL =
  "若指令已给出附件/基线路径，请直接 update_draft / render_tracked_draft / prepare_outbound_mail。" +
  "邮件合同请改用「设置 → 自动办件 → 邮件合同审阅改稿」短路径，停止反复检索。";

const DISCOVERY_STOP_HINT_WORD_REVISION =
  "原合同已钉选：用 analyze_document 或 read_project_file 通读一次（工作区/项目均可），然后 update_draft（contract_edit_baseline_path）→ apply_surgical_edits → render_tracked_draft。" +
  "不要 prepare_outbound_mail，不要反复检索。";

const DISCOVERY_STOP_HINT_DEFAULT =
  "若路径已给出，请改用正确根目录重试（工作区用 analyze_document，项目文件用 read_project_file），不要反复同一路径。";

const DISCOVERY_STOP_HINT_WORD_ALREADY_READ =
  "文书已通读。请直接 update_draft（contract_edit_baseline_path）→ apply_surgical_edits → render_tracked_draft。" +
  "不要再 analyze_document，不要读 playbooks。";

export function discoveryCountsShowDocumentRead(
  counts: Record<string, number> | undefined,
): boolean {
  return (counts?.analyze_document ?? 0) >= 1 || (counts?.read_project_file ?? 0) >= 1;
}

/** True when discoveryLoopMiddleware would reject this call without executing it. */
export function wouldHitDiscoveryCap(
  toolName: string,
  counts: Record<string, number> | undefined,
): boolean {
  const limit = DISCOVERY_LOOP_TOOL_LIMITS[toolName];
  if (limit == null) {
    return false;
  }
  const safe = counts ?? {};
  let discoveryTotal = 0;
  for (const name of Object.keys(DISCOVERY_LOOP_TOOL_LIMITS)) {
    discoveryTotal += safe[name] ?? 0;
  }
  if (discoveryTotal >= DISCOVERY_LOOP_TOTAL_CAP) {
    return true;
  }
  return (safe[toolName] ?? 0) >= limit;
}

/** Drop discovery tools that already used their per-turn quota (or the total cap). */
export function dropSaturatedDiscoveryTools(
  toolNames: string[],
  counts: Record<string, number> | undefined,
  opts?: { dropDocumentReaders?: boolean },
): string[] {
  const next = toolNames.filter((name) => !wouldHitDiscoveryCap(name, counts));
  if (!opts?.dropDocumentReaders) {
    return next;
  }
  return next.filter((name) => name !== "analyze_document" && name !== "read_project_file");
}

export function discoveryStopHint(
  allowlistDenyHint?: string,
  counts?: Record<string, number>,
): string {
  const h = allowlistDenyHint ?? "";
  if (/原 Word 改稿|不要准备外发|Word 改稿/.test(h)) {
    if (discoveryCountsShowDocumentRead(counts)) {
      return DISCOVERY_STOP_HINT_WORD_ALREADY_READ;
    }
    return DISCOVERY_STOP_HINT_WORD_REVISION;
  }
  if (/邮件合同/.test(h)) {
    return DISCOVERY_STOP_HINT_MAIL;
  }
  return DISCOVERY_STOP_HINT_DEFAULT;
}

/** Reject discovery/browse tools after they exceed per-turn caps. */
export const discoveryLoopMiddleware: ToolMiddleware = async (call, next) => {
  const limit = DISCOVERY_LOOP_TOOL_LIMITS[call.toolName];
  if (limit == null) {
    return next();
  }
  const counts = call.policy.toolNameCallCounts ?? {};
  let discoveryTotal = 0;
  for (const name of Object.keys(DISCOVERY_LOOP_TOOL_LIMITS)) {
    discoveryTotal += counts[name] ?? 0;
  }
  const hint = discoveryStopHint(call.policy.allowlistDenyHint, counts);
  if (discoveryTotal >= DISCOVERY_LOOP_TOTAL_CAP) {
    return {
      ok: false,
      error: `本轮检索/浏览类工具已合计 ${discoveryTotal} 次（上限 ${DISCOVERY_LOOP_TOTAL_CAP}）。${hint}`,
    };
  }
  const prior = counts[call.toolName] ?? 0;
  if (prior >= limit) {
    return {
      ok: false,
      error: `${call.toolName} 本轮已调用 ${prior} 次（上限 ${limit}）。${hint}`,
    };
  }
  return next();
};

/** 需绑定案件的文件/检索工具；无 matterId（上下文或参数）时拒绝。单一来源在 tool-name-sets。 */
export const MATTER_SCOPED_TOOL_NAMES = MATTER_SCOPE_REQUIRED;

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

/** Role / preset / playbook allowlist；不在白名单 → 拒绝。 */
export const roleAllowlistMiddleware: ToolMiddleware = async (call, next) => {
  const allow = call.policy.allowedToolNames;
  if (allow && allow.length > 0 && !allow.includes(call.toolName)) {
    const hint = call.policy.allowlistDenyHint?.trim();
    return {
      ok: false,
      error: hint
        ? `当前办件不能使用「${call.toolName}」。${hint}`
        : `当前办件不能使用「${call.toolName}」。`,
    };
  }
  return next();
};

/** Clarification gate：待澄清时禁止起草/工作流/渲染/导出/外发；允许只读与 research_task。 */
export const clarificationGateMiddleware: ToolMiddleware = async (call, next) => {
  if (call.ctx.clarificationBlockingHeavyTools && WRITE_HEAVY_TOOL_NAMES.has(call.toolName)) {
    return {
      ok: false,
      error:
        "仍有待澄清事项：请先请律师回答上一轮列出的问题（在对话卡片中逐条作答将立即放行），" +
        "再执行起草、改稿、完整工作流、渲染导出或外发。澄清期间仍可只读检索与 analyze。" +
        "若律师已用普通消息回答，本轮请先只读/回复确认，下一轮将自动放行。",
    };
  }
  return next();
};

const RISK_ORDER: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

/** 危险工具未 `__approved` → 拒绝（带 pendingApproval=true）。 */
export const approvalMiddleware: ToolMiddleware = async (call, next) => {
  if (!call.tool) {
    return next();
  }
  let requires = toolRequiresExplicitApproval({
    toolName: call.toolName,
    definition: call.tool.definition,
    allowDangerousToolsWithoutApproval: call.policy.allowDangerousToolsWithoutApproval,
    strictDangerousToolApproval: call.policy.strictDangerousToolApproval,
  });
  // 风险上限只拦真正发信；内部起草/审查/导出不因 high 风险打断律师。
  if (!requires && call.policy.riskCeiling && toolRequiresLawyerPause(call.toolName)) {
    const toolRisk = resolveToolRiskLevel(call.tool.definition);
    if (RISK_ORDER[toolRisk] > RISK_ORDER[call.policy.riskCeiling]) {
      requires = true;
    }
  }
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
  const prev = call.ctx.abortSignal;
  const combined = combineAbortSignals(call.policy.toolTimeoutMs, prev);
  call.ctx.abortSignal = combined.signal;
  try {
    if (prev?.aborted) {
      return { ok: false, error: "已停止", aborted: true };
    }
    const timedOutResult = (): ToolCallResult =>
      combined.wasUserAbort()
        ? { ok: false, error: "已停止", aborted: true }
        : {
            ok: false,
            error: `Tool ${call.toolName} timed out after ${call.policy.toolTimeoutMs}ms`,
            timedOut: true,
          };
    const run = next().catch((err): ToolCallResult => {
      if (combined.wasUserAbort()) {
        return { ok: false, error: "已停止", aborted: true };
      }
      if (combined.signal.aborted) {
        return timedOutResult();
      }
      return {
        ok: false,
        error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
      };
    });
    return await Promise.race([
      run,
      new Promise<ToolCallResult>((resolve) => {
        const fail = () => resolve(timedOutResult());
        if (combined.signal.aborted) {
          fail();
          return;
        }
        combined.signal.addEventListener("abort", fail, { once: true });
      }),
    ]);
  } finally {
    combined.cleanup();
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
    return { ok: false, error: `未知工具：${call.toolName}。该工具未注册，请核对请求。` };
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
    discoveryLoopMiddleware,
    roleAllowlistMiddleware,
    matterScopeMiddleware,
    clarificationGateMiddleware,
    approvalMiddleware,
    argNormalizeMiddleware,
    argSchemaMiddleware,
    legalVerifyMiddleware,
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
