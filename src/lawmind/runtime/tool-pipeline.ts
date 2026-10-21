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

import { createHash } from "node:crypto";
import {
  toolRequiresExplicitApproval,
  toolRequiresSubprocessSandbox,
} from "../agent/dangerous-tool-policy.js";
import { NO_TASK_TURN_TOOL_ERROR } from "../agent/no-task-turn.js";
import { READONLY_AGENT_TOOL_NAMES, RESEARCH_AGENT_TOOL_NAMES } from "../agent/permission-mode.js";
import { combineAbortSignals } from "../agent/runtime-model-call.js";
import { normalizeToolCallArguments } from "../agent/runtime-tool-arg-normalize.js";
import {
  stripUnknownToolArguments,
  validateToolArguments,
} from "../agent/runtime-tool-validation.js";
import { presentLawyerToolCall } from "../agent/tool-lawyer-card.js";
import {
  IDEMPOTENT_READ_TOOLS,
  MATTER_SCOPE_REQUIRED,
  WRITE_TOOLS,
  irreversibleImpactLabelZh,
} from "../agent/tool-name-sets.js";
import { resolveToolRiskLevel } from "../agent/tools/governance.js";
import { UPDATE_PLAN_TOOL_NAME } from "../agent/turn-plan-model.js";
import type { AgentContext, AgentTool, ToolCallResult, ToolDefinition } from "../agent/types.js";
import { emit } from "../audit/index.js";
import { resolveHostAccessPolicy } from "../host-access/host-policy.js";
import {
  recordActionPreReviewShadow,
  resolveActionPreReview,
} from "../platform/action-pre-review.js";
import { resolveApprovalArbitration } from "../platform/approval-arbitration.js";
import { withGateCategory } from "../platform/gate-category.js";
import { toolRequiresLawyerPause } from "../platform/lawyer-outbound-decision.js";
import { toolDisplayNameZh } from "../platform/requires-action.js";
import { redactApprovalValue } from "../platform/tool-approval-diff.js";
import { IcloudLawyerPrompt } from "./icloud-materialize.js";
import { legalVerifyMiddleware } from "./legal-verify-middleware.js";
import {
  toolCallBatchSignature,
  stableToolJson,
  type ToolCallSignatures,
} from "./tool-call-signature.js";
import { runToolInSubprocessSandbox } from "./tool-sandbox.js";
import { isUnlimitedToolTimeoutMs, resolveToolWallTimeoutMs } from "./tool-timeout-env.js";
import {
  AdmissionAbortedError,
  resourceLeaseKeyForTool,
  withResourceLease,
  withTurnToolSlot,
} from "./turn-admission.js";

/**
 * Write/export tools blocked while clarification is pending.
 * research_task and other read/analyze tools stay allowed so the model can
 * gather facts before the lawyer answers.
 * Align with WRITE_TOOLS plus sidecar draft_worker so 产出/交付面 writes
 * cannot run while hard clarification is open.
 */
const WRITE_HEAVY_TOOL_NAMES = new Set<string>([...WRITE_TOOLS, "draft_worker"]);

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
  /** Playbook deny-list (mail/word). Checked before the role allowlist. */
  deniedToolNames?: string[];
  /** Extra lawyer-facing reason when a tool is outside the allowlist or on the deny-list. */
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
  toolCallSignatures?: ToolCallSignatures;
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
 * 权限模式硬门禁（执行层）：readonly / research 模式下，不在只读白名单内的工具
 * （写/起草/渲染/外发/工作流等）在管线层直接拒绝，并附 dangerous_tool_gate 阻断决定。
 *
 * 发给模型的工具广告清单（resolveModelToolNames）只是提示层：模型幻觉、被注入的
 * 模型输出或历史 tool_call 重放都可能绕过清单直接点名写工具，本中间件是唯一强制点。
 * 与 roleAllowlistMiddleware 分开：allowlist 是「办件/岗位」业务口径，本门禁是
 * 律师设置的会话级安全边界，拒绝话术需明确指向权限模式而非办件锁。
 * 模式来源：AgentContext.permissionMode（turn 边界解析后写入，model loop 逐轮镜像；
 * 子助手经 child-gates 继承，只会更严）。
 */
export const permissionModeMiddleware: ToolMiddleware = async (call, next) => {
  const mode = call.ctx.permissionMode ?? "standard";
  const allowed =
    mode === "readonly"
      ? READONLY_AGENT_TOOL_NAMES
      : mode === "research"
        ? RESEARCH_AGENT_TOOL_NAMES
        : undefined;
  if (!allowed || allowed.has(call.toolName)) {
    return next();
  }
  const message =
    mode === "readonly"
      ? `当前权限模式为只读（readonly），不能使用「${call.toolName}」。` +
        "请改用只读检索/分析工具收集材料；确需起草、导出或外发时，请律师把权限模式切换为标准后再执行。"
      : `当前权限模式为研究（research），不能使用「${call.toolName}」。` +
        "研究模式只允许只读工具与 research_task；确需起草、导出或外发时，请律师把权限模式切换为标准后再执行。";
  const lawyerMessage =
    mode === "readonly"
      ? "当前是只读，不能起草、导出或外发。请改用只读检索收集材料；确需写稿时，把权限切换为标准后再执行。"
      : "当前是研究，不能起草、导出或外发。请先用只读检索收集材料；确需写稿时，把权限切换为标准后再执行。";
  return {
    ok: false,
    error: message,
    data: {
      lawyerMessage,
      gateDecision: withGateCategory({
        gate: "dangerous_tool_gate",
        decision: "block",
        reason: lawyerMessage,
      }),
    },
  };
};

/**
 * Per-tool **soft** thresholds. Reaching one is a signal that the model may be
 * spinning — not a reason to take the tool away.
 *
 * 2026-10-21 语义修正：旧实现把这里当硬上限，第 3 次查同一个工具就把工具从
 * 下一轮工具表里移走。可是「查付款条款 → 查验收 → 查质保」是正常推进，
 * 次数本身不说明重复。现在：
 *   - 到阈值只意味着「可能该换个问法」，由回合策略给出提示；
 *   - 真正的物理拦截只在两种情况下发生：**本轮检索总预算用尽**，或
 *     **同一工具被用到病态次数**（见 {@link resolveDiscoveryPerToolCeiling}）；
 *   - 同一组参数反复调用由 `turn-loop-policies` 的 identical-repeat 守卫负责
 *     （它看得见参数，本中间件看不见）。
 */
export const DISCOVERY_LOOP_TOOL_LIMITS: Readonly<Record<string, number>> = {
  search_workspace: 3,
  search_matter: 2,
  read_project_file: 8,
  list_templates: 2,
  get_matter_summary: 2,
  list_matters: 2,
  analyze_document: 8,
  list_tasks: 2,
  list_drafts: 2,
  list_mail_inbox: 2,
  list_mail_attachments: 2,
};

/**
 * 病态次数上限：到这个数才认为「不是换问法能解决」，直接拦。
 * 取 soft 阈值的 4 倍（至少 +6），给正常的多文件/多争点工作留足空间。
 */
export function resolveDiscoveryPerToolCeiling(toolName: string): number {
  const soft = DISCOVERY_LOOP_TOOL_LIMITS[toolName];
  if (soft == null) {
    return 0;
  }
  return Math.max(soft * 4, soft + 6);
}

/** Search/list tools that share a combined cap. Document readers are excluded. */
const DISCOVERY_SEARCH_LOOP_NAMES = new Set([
  "search_workspace",
  "search_matter",
  "list_templates",
  "get_matter_summary",
  "list_matters",
  "list_tasks",
  "list_drafts",
  "list_mail_inbox",
  "list_mail_attachments",
]);

/**
 * Combined search/list cap per turn. Does not count analyze_document / read_project_file.
 * 随模型上下文伸缩：未知窗口 8；128k→16；上限 32。检索/列表本身很便宜，
 * 该上限只防同一查询反复打转；案件管理类工作（列案件 + 摘要 + 案卷检索）常需十余次。
 */
export const DISCOVERY_LOOP_TOTAL_CAP = 8;
export const DISCOVERY_LOOP_TOTAL_CAP_MAX = 32;

export function resolveDiscoveryLoopTotalCap(contextTokens?: number): number {
  if (typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0) {
    return Math.min(
      DISCOVERY_LOOP_TOTAL_CAP_MAX,
      Math.max(DISCOVERY_LOOP_TOTAL_CAP, Math.ceil(contextTokens / 8_000)),
    );
  }
  return DISCOVERY_LOOP_TOTAL_CAP;
}

/** Host-file tools use a separate ledger so file-dense work is not killed by the discovery cap. */
export const HOST_FILE_TOOL_NAMES = new Set([
  "search_host",
  "read_host_file",
  "list_dir",
  "read_folder_documents",
  "digest_materials",
]);
/**
 * 单工具读取上限随模型上下文伸缩（不写死小数字；律师一个材料夹常有二三十份文书）。
 * 未知窗口 24；32k→12；128k→32；上限 48。
 * 授权边界在 Access Broker（deny-list / matter fence / grants），本上限只防
 * 「同一份文件反复读」的死循环，不是安全边界。
 */
export const HOST_FILE_PER_TOOL_LIMIT_FALLBACK = 24;
export const HOST_FILE_PER_TOOL_LIMIT_MIN = 12;
export const HOST_FILE_PER_TOOL_LIMIT_MAX = 48;

export function resolveHostFilePerToolLimit(contextTokens?: number): number {
  if (typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0) {
    return Math.min(
      HOST_FILE_PER_TOOL_LIMIT_MAX,
      Math.max(HOST_FILE_PER_TOOL_LIMIT_MIN, Math.ceil(contextTokens / 4_096)),
    );
  }
  return HOST_FILE_PER_TOOL_LIMIT_FALLBACK;
}

export type HostFileLedgerHint = {
  projectDir?: string;
  hostMounts?: unknown[];
  contextPins?: Array<{ pinKind?: string; kind?: string }>;
  hostFileLedger?: boolean;
  /** Active chat model context window; caps scale with it instead of a hardcoded small number. */
  contextTokens?: number;
};

export function contextUsesHostFileLedger(hint?: HostFileLedgerHint): boolean {
  if (!hint) {
    return false;
  }
  if (hint.hostFileLedger === true) {
    return true;
  }
  if (hint.projectDir?.trim()) {
    return true;
  }
  if ((hint.hostMounts?.length ?? 0) > 0) {
    return true;
  }
  return (hint.contextPins ?? []).some((pin) => pin.pinKind === "file" && pin.kind === "directory");
}

export function usesHostFileLedger(toolName: string, hint?: HostFileLedgerHint): boolean {
  if (HOST_FILE_TOOL_NAMES.has(toolName)) {
    return true;
  }
  if (toolName !== "analyze_document" && toolName !== "read_project_file") {
    return false;
  }
  return contextUsesHostFileLedger(hint);
}

function hostLedgerCountNames(hint?: HostFileLedgerHint): string[] {
  const names = [...HOST_FILE_TOOL_NAMES];
  if (contextUsesHostFileLedger(hint)) {
    names.push("analyze_document", "read_project_file");
  }
  return names;
}

const DISCOVERY_STOP_HINT_MAIL =
  "附件路径已在指令里，不要反复检索案卷。核法条可以用 search_statute。" +
  "不要 send_email，不要用 render_document 重建附件。";

const DISCOVERY_STOP_HINT_WORD_REVISION =
  "原文件路径已钉选，不要反复检索。通读一次后改稿即可。" +
  "不要 prepare_outbound_mail，不要用 render_document 重建原件。";

const DISCOVERY_STOP_HINT_DEFAULT =
  "若路径已给出，请改用正确根目录重试（工作区用 analyze_document，项目文件用 read_project_file），不要反复同一路径。";

const DISCOVERY_STOP_HINT_WORD_ALREADY_READ =
  "这份文书已经读过。换一份未读材料可以继续读；不要反复读同一文件，也不要读 playbooks。继续改稿即可。";

export function discoveryCountsShowDocumentRead(
  counts: Record<string, number> | undefined,
): boolean {
  return (counts?.analyze_document ?? 0) >= 1 || (counts?.read_project_file ?? 0) >= 1;
}

/** True when discoveryLoopMiddleware would reject this call without executing it. */
export function wouldHitDiscoveryCap(
  toolName: string,
  counts: Record<string, number> | undefined,
  hint?: HostFileLedgerHint,
): boolean {
  if (usesHostFileLedger(toolName, hint)) {
    return false;
  }
  const ceiling = resolveDiscoveryPerToolCeiling(toolName);
  if (ceiling === 0) {
    return false;
  }
  const safe = counts ?? {};
  const totalCap = resolveDiscoveryLoopTotalCap(hint?.contextTokens);
  if (DISCOVERY_SEARCH_LOOP_NAMES.has(toolName)) {
    let searchTotal = 0;
    for (const name of DISCOVERY_SEARCH_LOOP_NAMES) {
      searchTotal += safe[name] ?? 0;
    }
    if (searchTotal >= totalCap) {
      return true;
    }
  }
  return (safe[toolName] ?? 0) >= ceiling;
}

/**
 * 是否已越过 soft 阈值（该提示换问法了）。
 * 只用于提示，不用于移出工具表——次数多不等于重复。
 */
export function isPastDiscoverySoftLimit(
  toolName: string,
  counts: Record<string, number> | undefined,
): boolean {
  const soft = DISCOVERY_LOOP_TOOL_LIMITS[toolName];
  if (soft == null) {
    return false;
  }
  return (counts?.[toolName] ?? 0) >= soft;
}

/**
 * 工具表里只移除「本轮真的用不了」的：检索总预算已用尽、或某工具已到病态次数。
 * 不再因为「查了几次」就提前把工具藏起来。
 */
export function dropSaturatedDiscoveryTools(
  toolNames: string[],
  counts: Record<string, number> | undefined,
  opts?: HostFileLedgerHint,
): string[] {
  return toolNames.filter((name) => !wouldHitDiscoveryCap(name, counts, opts));
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

/** Reject discovery/browse tools only at the turn budget or a pathological repeat count. */
export const discoveryLoopMiddleware: ToolMiddleware = async (call, next) => {
  if (usesHostFileLedger(call.toolName, call.ctx)) {
    return next();
  }
  const ceiling = resolveDiscoveryPerToolCeiling(call.toolName);
  if (ceiling === 0) {
    return next();
  }
  const counts = call.policy.toolNameCallCounts ?? {};
  const hint = discoveryStopHint(call.policy.allowlistDenyHint, counts);
  const totalCap = resolveDiscoveryLoopTotalCap(call.ctx.chatModel?.contextTokens);
  if (DISCOVERY_SEARCH_LOOP_NAMES.has(call.toolName)) {
    let searchTotal = 0;
    for (const name of DISCOVERY_SEARCH_LOOP_NAMES) {
      searchTotal += counts[name] ?? 0;
    }
    if (searchTotal >= totalCap) {
      return {
        ok: false,
        error: `本轮检索/列表类工具已合计 ${searchTotal} 次（上限 ${totalCap}）。${hint}`,
      };
    }
  }
  const prior = counts[call.toolName] ?? 0;
  if (prior >= ceiling) {
    return {
      ok: false,
      error: `${call.toolName} 本轮已调用 ${prior} 次，超过本轮可用的 ${ceiling} 次。${hint}`,
    };
  }
  const signatures = call.policy.toolCallSignatures;
  const signature = toolCallBatchSignature([{ name: call.toolName, arguments: call.args }]);
  const previous = signatures?.[signature];
  const result = await next();
  if (!signatures) {
    return result;
  }
  const fingerprint = createHash("sha256")
    .update(
      stableToolJson({
        ok: result.ok,
        data: result.data,
        error: result.error,
      }),
    )
    .digest("hex");
  const repeats = previous?.result === fingerprint ? previous.repeats + 1 : 1;
  const repeatLimit = Math.max(2, DISCOVERY_LOOP_TOOL_LIMITS[call.toolName] ?? 3);
  const nudged = previous?.result === fingerprint && previous.nudged;
  signatures[signature] = {
    result: fingerprint,
    repeats,
    nudged: nudged || repeats >= repeatLimit,
    guardNudged: previous?.result === fingerprint ? previous.guardNudged : false,
  };
  if (repeats >= repeatLimit) {
    const note = nudged
      ? "相同参数再次返回相同结果，请停止重复查询，基于已有依据继续交付。"
      : "该查询已返回相同结果；请换争点或问法，不要重复同一查询。";
    return {
      ...result,
      data: {
        ...(result.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? result.data
          : { result: result.data }),
        discoveryRepeat: { repeats, stop: nudged, note },
      },
    };
  }
  if (isPastDiscoverySoftLimit(call.toolName, counts)) {
    call.ctx.emitToolProgress?.("已多次检索，请核对是否还需要新增争点。");
  }
  return result;
};

export function hostFileLedgerTotal(
  counts: Record<string, number> | undefined,
  hint?: HostFileLedgerHint,
): number {
  const safe = counts ?? {};
  let total = 0;
  for (const name of hostLedgerCountNames(hint)) {
    total += safe[name] ?? 0;
  }
  return total;
}

export function wouldHitHostFileCap(
  toolName: string,
  counts: Record<string, number> | undefined,
  hardCap = 32,
  hint?: HostFileLedgerHint,
  contextTokens?: number,
): boolean {
  if (!usesHostFileLedger(toolName, hint)) {
    return false;
  }
  const safe = counts ?? {};
  if (hostFileLedgerTotal(safe, hint) >= hardCap) {
    return true;
  }
  return (safe[toolName] ?? 0) >= resolveHostFilePerToolLimit(contextTokens);
}

export const hostFileLoopMiddleware: ToolMiddleware = async (call, next) => {
  if (!usesHostFileLedger(call.toolName, call.ctx)) {
    return next();
  }
  const policy = resolveHostAccessPolicy(call.ctx.workspaceDir);
  const counts = call.policy.toolNameCallCounts ?? {};
  const contextTokens = call.ctx.chatModel?.contextTokens;
  if (
    wouldHitHostFileCap(call.toolName, counts, policy.fileTaskReadHardCap, call.ctx, contextTokens)
  ) {
    const perTool = resolveHostFilePerToolLimit(contextTokens);
    const usedPerTool = counts[call.toolName] ?? 0;
    const usedTotal = hostFileLedgerTotal(counts, call.ctx);
    const bulkHint =
      call.toolName === "analyze_document" || call.toolName === "read_project_file"
        ? "批量读整个文件夹请改用 read_folder_documents（一次读多个文件，只计 1 次）；"
        : "";
    return {
      ok: false,
      error:
        `本机查找/阅读已达本轮上限（${call.toolName} ${usedPerTool} 次，单工具上限 ${perTool}；` +
        `本类合计 ${usedTotal}/${policy.fileTaskReadHardCap}）。${bulkHint}` +
        `换一轮会重置；不要对未读材料按文件名推断。`,
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

/** Role / preset allowlist, plus playbook deny-list. */
export const roleAllowlistMiddleware: ToolMiddleware = async (call, next) => {
  const deny = call.policy.deniedToolNames;
  if (deny && deny.length > 0 && deny.includes(call.toolName)) {
    const hint = call.policy.allowlistDenyHint?.trim();
    return {
      ok: false,
      error: hint
        ? `当前办件不能使用「${call.toolName}」。${hint}`
        : `当前办件不能使用「${call.toolName}」。`,
    };
  }
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

/**
 * Codex 对齐：本轮原话不构成任务（单字 / 纯确认）→ 收全部写 / 导出 / 外发，
 * 避免顺着上一轮上下文把已停的办件流水线重启。只读与检索照旧可用。
 * `update_plan` 一并收掉：无任务回合不该凭空写清单。
 */
export const noTaskTurnGateMiddleware: ToolMiddleware = async (call, next) => {
  if (
    call.ctx.noTaskTurn === true &&
    (WRITE_HEAVY_TOOL_NAMES.has(call.toolName) || call.toolName === UPDATE_PLAN_TOOL_NAME)
  ) {
    return {
      ok: false,
      error: NO_TASK_TURN_TOOL_ERROR,
      data: {
        gateDecision: withGateCategory({
          gate: "dangerous_tool_gate",
          decision: "block",
          reason: "本轮无新指令（单字或确认）：写类工具已关闭。",
        }),
      },
    };
  }
  return next();
};

/**
 * 文件夹钉选不再冻结写工具（铁律 5）。先读再改由模型自己排。
 * 中间件保留在链上，避免调用方按序号假设关卡，但不再拒绝。
 */
export const folderExploreGateMiddleware: ToolMiddleware = async (_call, next) => next();

const RISK_ORDER: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

/**
 * 动作级审前评审（D1）：默认 off；shadow 只记；on 对本层拥有的高风险本机动作 Ask。
 * 插在 legalVerify 之后、approval 之前——不得绕过确定性闸，也不替代 send_email 暂停。
 */
export const actionPreReviewMiddleware: ToolMiddleware = async (call, next) => {
  const decision = resolveActionPreReview({
    toolName: call.toolName,
    alreadyApproved: call.args.__approved === true,
    context: { args: call.args, workspaceRoot: call.ctx.workspaceDir },
  });
  if (decision.shouldRecord) {
    try {
      recordActionPreReviewShadow(call.ctx.workspaceDir, {
        toolName: call.toolName,
        mode: decision.mode,
        recommend: decision.classification.recommend,
        reasonZh: decision.classification.reasonZh,
        wouldAsk:
          decision.classification.ownedByThisLayer &&
          decision.classification.recommend === "ask" &&
          call.args.__approved !== true,
        sessionId: call.ctx.sessionId,
        codes: decision.classification.codes,
      });
    } catch {
      /* 影子日志失败不得影响办件 */
    }
  }
  if (decision.shouldAsk) {
    const reason = decision.classification.reasonZh;
    return {
      ok: false,
      error: reason,
      approvalRequest: true,
      data: {
        gateDecision: withGateCategory({
          gate: "approval_gate",
          decision: "awaiting_confirmation",
          reason,
          category: "safety_hard",
        }),
      },
    };
  }
  return next();
};

/**
 * 危险工具未 `__approved` → 生成统一审批请求（approvalRequest=true），
 * 不返回错误式 retry 提示。系统会把该 turn 置为 awaiting_approval 并在 UI
 * 的「待我拍板」中展示；律师批准后由 resume 路径注入 `__approved` 再执行。
 * `__approved` 是服务端能力位：只能由 turn 边界在律师预批准/沙箱策略下注入，
 * 模型自填的副本在进入本管线前已被剥除（turn-orchestrator-tool-round）。
 */
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
  // Deny/block 已由上游 middleware 处理；此处只仲裁 Ask first vs Allow。
  // Ask first 命中即停；`__approved` 仅在无 Ask 时放行（见 approval-arbitration.ts）。
  const askFirst = requires && call.args.__approved !== true;
  const outcome = resolveApprovalArbitration({
    denied: false,
    blocked: false,
    askFirst,
    allowAutomatically: call.args.__approved === true || !requires,
  });
  if (outcome === "ask") {
    const reason = describeApprovalRequest(call.toolName, call.args);
    return {
      ok: false,
      error: reason,
      approvalRequest: true,
      data: {
        gateDecision: withGateCategory({
          gate: "approval_gate",
          decision: "awaiting_confirmation",
          reason,
          category: "safety_hard",
        }),
      },
    };
  }
  return next();
};

/**
 * 审批理由：让律师不点开详情也能判断要不要点头。
 *
 * 以前只有一句「操作「apply_surgical_edits」需要律师确认」——律师看到的是工具名，
 * 不是「要改哪份文件的哪一句、批准了会怎样」。现在拼三件事：
 *   目的（模型的 purpose / 卡片里的中文标题）
 *   关键参数（文件、命令、收件人；不含正文）
 *   影响面（`irreversibleImpactLabelZh`）
 *
 * 安全判定不依赖这段文案：它只解释，权限仍由真实参数与 policy 决定。
 */
export function describeApprovalRequest(
  toolName: string,
  args: Record<string, unknown> = {},
): string {
  const label = toolDisplayNameZh(toolName);
  const card = presentLawyerToolCall(toolName, args);
  const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
  const target = approvalTargetHint(toolName, args);
  const impact = irreversibleImpactLabelZh(toolName);

  const head = purpose
    ? `拟${purpose}（${label}${card.detail ? ` · ${card.detail}` : ""}）`
    : `拟进行「${label}」${card.detail ? `：${card.detail}` : ""}`;
  const scope = target ? `；涉及：${target}` : "";
  return String(redactApprovalValue(`${head}${scope}。${impact}。批准后才会执行。`));
}

/** 关键参数摘要：只说「对什么动手」，不搬运正文内容。 */
function approvalTargetHint(toolName: string, args: Record<string, unknown>): string {
  const pick = (keys: readonly string[]): string => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  };
  if (toolName === "run_host_command") {
    const command = pick(["command"]);
    const extra = Array.isArray(args.args)
      ? args.args.filter((a): a is string => typeof a === "string").slice(0, 4)
      : [];
    return [command, ...extra].filter(Boolean).join(" ");
  }
  if (toolName === "send_email" || toolName === "prepare_outbound_mail") {
    const to = pick(["to", "recipient"]);
    const subject = pick(["subject"]);
    return [to, subject].filter(Boolean).join(" · ");
  }
  return pick([
    "file_path",
    "path",
    "rel_path",
    "output_path",
    "task_id",
    "matter_id",
    "query",
    "instruction",
  ]);
}

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
 * 又通过 `controller.abort()` 翻转本次调用的派生 signal，让读取该 signal 的工具
 * （fetch / 模型调用 / 子进程）取消底层工作，而不是让它在超时后继续跑到完成。
 *
 * 并发批共享同一个 AgentContext：不能改写共享 `ctx.abortSignal`（一个工具超时
 * 会把其他在途工具一起取消，或互相覆盖 signal）。因此超时 signal 以 per-call
 * 浅拷贝的形式注入——仅本次调用的下游中间件/工具看到派生 signal。
 */
/**
 * Timeout injects a per-call abortSignal via shallow ctx copy. Write-back the
 * fields tools are allowed to stick on ctx so the shared AgentContext still
 * sees them after restore (update_plan, legacy craft patch).
 */
function copyPendingCtxFields(from: AgentContext, to: AgentContext): void {
  if (from.pendingTurnPlan) {
    to.pendingTurnPlan = from.pendingTurnPlan;
  }
  if (from.pendingWorldStateCraftPatch) {
    to.pendingWorldStateCraftPatch = from.pendingWorldStateCraftPatch;
  }
}

export const timeoutMiddleware: ToolMiddleware = async (call, next) => {
  // Scoped timeout contexts must share the turn's file-version ledger.
  call.ctx.turnFileVersions ??= Object.create(null) as Record<string, string>;
  const wallMs = resolveToolWallTimeoutMs(call.toolName, call.policy.toolTimeoutMs);
  if (isUnlimitedToolTimeoutMs(wallMs)) {
    const prev = call.ctx.abortSignal;
    if (prev?.aborted) {
      return { ok: false, error: "已停止", aborted: true };
    }
    const prevCtx = call.ctx;
    call.ctx = { ...prevCtx, abortSignal: prev };
    try {
      return await next().catch((err): ToolCallResult => {
        if (prev?.aborted) {
          return { ok: false, error: "已停止", aborted: true };
        }
        return {
          ok: false,
          error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
        };
      });
    } finally {
      copyPendingCtxFields(call.ctx, prevCtx);
      call.ctx = prevCtx;
    }
  }
  const prev = call.ctx.abortSignal;
  const combined = combineAbortSignals(wallMs, prev);
  const prevCtx = call.ctx;
  call.ctx = { ...prevCtx, abortSignal: combined.signal };
  try {
    if (prev?.aborted) {
      return { ok: false, error: "已停止", aborted: true };
    }
    const timedOutResult = (): ToolCallResult =>
      combined.wasUserAbort()
        ? { ok: false, error: "已停止", aborted: true }
        : {
            ok: false,
            error: `Tool ${call.toolName} timed out after ${wallMs}ms`,
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
    copyPendingCtxFields(call.ctx, prevCtx);
    call.ctx = prevCtx;
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

function toolCallIsConcurrencySafe(call: ToolCallContext): boolean {
  if (call.tool?.definition.requiresApproval === true) {
    return false;
  }
  const flag = call.tool?.definition.isConcurrencySafe;
  if (flag === true) {
    return true;
  }
  if (flag === false) {
    return false;
  }
  return IDEMPOTENT_READ_TOOLS.has(call.toolName);
}

/** 终态：执行 tool.execute()。只读检索不占空位。写操作按对话限流，同一路径才跨对话排队。 */
export const executeMiddleware: ToolMiddleware = async (call) => {
  if (!call.tool) {
    return { ok: false, error: `未知工具：${call.toolName}。该工具未注册，请核对请求。` };
  }
  const execute = async (): Promise<ToolCallResult> => {
    try {
      return await call.tool!.execute(call.args, call.ctx);
    } catch (err) {
      if (err instanceof IcloudLawyerPrompt) {
        return {
          ok: true,
          data: {
            icloudDownloadAsk: true,
            clarificationQuestions: [err.question],
          },
        };
      }
      if (err instanceof AdmissionAbortedError) {
        return { ok: false, error: "已停止" };
      }
      return {
        ok: false,
        error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
  const safe = toolCallIsConcurrencySafe(call);
  const leaseKey = resourceLeaseKeyForTool(call.toolName, call.args, safe);
  const slotted = () =>
    withTurnToolSlot(execute, {
      signal: call.ctx.abortSignal,
      identity: call.ctx.sessionId ? { sessionId: call.ctx.sessionId, kind: "parent" } : undefined,
      onWait: () => call.ctx.emitToolProgress?.("这一轮的工具在排队"),
    });
  try {
    if (safe && !leaseKey) {
      return await execute();
    }
    if (!leaseKey) {
      return await slotted();
    }
    return await withResourceLease(leaseKey, slotted, {
      signal: call.ctx.abortSignal,
      onWait: () => call.ctx.emitToolProgress?.("排队等同一份文件"),
    });
  } catch (err) {
    if (err instanceof AdmissionAbortedError) {
      return { ok: false, error: "已停止" };
    }
    throw err;
  }
};

/** 默认中间件链。 */
export function buildDefaultToolPipeline(): ToolMiddleware[] {
  return [
    unknownToolMiddleware,
    budgetMiddleware,
    noTaskTurnGateMiddleware,
    permissionModeMiddleware,
    discoveryLoopMiddleware,
    hostFileLoopMiddleware,
    roleAllowlistMiddleware,
    matterScopeMiddleware,
    clarificationGateMiddleware,
    folderExploreGateMiddleware,
    argNormalizeMiddleware,
    argSchemaMiddleware,
    legalVerifyMiddleware,
    actionPreReviewMiddleware,
    approvalMiddleware,
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
