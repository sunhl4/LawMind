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
import { READONLY_AGENT_TOOL_NAMES, RESEARCH_AGENT_TOOL_NAMES } from "../agent/permission-mode.js";
import { combineAbortSignals } from "../agent/runtime-model-call.js";
import { normalizeToolCallArguments } from "../agent/runtime-tool-arg-normalize.js";
import {
  stripUnknownToolArguments,
  validateToolArguments,
} from "../agent/runtime-tool-validation.js";
import { MATTER_SCOPE_REQUIRED, WRITE_TOOLS } from "../agent/tool-name-sets.js";
import { resolveToolRiskLevel } from "../agent/tools/governance.js";
import type { AgentContext, AgentTool, ToolCallResult, ToolDefinition } from "../agent/types.js";
import { emit } from "../audit/index.js";
import { resolveHostAccessPolicy } from "../host-access/host-policy.js";
import { withGateCategory } from "../platform/gate-category.js";
import { toolRequiresLawyerPause } from "../platform/lawyer-outbound-decision.js";
import { legalVerifyMiddleware } from "./legal-verify-middleware.js";
import { runToolInSubprocessSandbox } from "./tool-sandbox.js";
import { isUnlimitedToolTimeoutMs } from "./tool-timeout-env.js";

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
  return {
    ok: false,
    error: message,
    data: {
      gateDecision: withGateCategory({
        gate: "dangerous_tool_gate",
        decision: "block",
        reason: message,
      }),
    },
  };
};

/**
 * Per-turn caps. Document readers are high so multi-file work can finish
 * (Cursor/Codex read many files). Search/list stay modest to stop death spirals.
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
  const limit = DISCOVERY_LOOP_TOOL_LIMITS[toolName];
  if (limit == null) {
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
  return (safe[toolName] ?? 0) >= limit;
}

/** Drop discovery tools that already used their per-turn quota (or the total cap). */
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

/** Reject discovery/browse tools after they exceed per-turn caps. */
export const discoveryLoopMiddleware: ToolMiddleware = async (call, next) => {
  if (usesHostFileLedger(call.toolName, call.ctx)) {
    return next();
  }
  const limit = DISCOVERY_LOOP_TOOL_LIMITS[call.toolName];
  if (limit == null) {
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
  if (prior >= limit) {
    return {
      ok: false,
      error: `${call.toolName} 本轮已调用 ${prior} 次（上限 ${limit}）。${hint}`,
    };
  }
  return next();
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

/** Model-facing: folder talk must explore before mutating. */
export const FOLDER_EXPLORE_GATE_ERROR =
  "请先探查文件夹（explore_folder：goal / not_goal / path；或 read_folder_documents 批量读取正文），看清目录并摘录要点后再起草或改稿。";

/**
 * Folder / directory-pin gate: WRITE_HEAVY waits until this turn already
 * executed explore_folder / read_folder_documents. Folder readers themselves
 * and all read tools stay open.
 */
export const folderExploreGateMiddleware: ToolMiddleware = async (call, next) => {
  if (!call.ctx.folderExploreRequired) {
    return next();
  }
  if (
    call.toolName === "explore_folder" ||
    call.toolName === "read_folder_documents" ||
    !WRITE_HEAVY_TOOL_NAMES.has(call.toolName)
  ) {
    return next();
  }
  const counts = call.policy.toolNameCallCounts ?? {};
  const explored = (counts.explore_folder ?? 0) > 0 || (counts.read_folder_documents ?? 0) > 0;
  if (explored) {
    return next();
  }
  return { ok: false, error: FOLDER_EXPLORE_GATE_ERROR };
};

const RISK_ORDER: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

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
  if (requires && call.args.__approved !== true) {
    const reason = `操作「${call.toolName}」需要律师在「待我拍板」中确认。`;
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
  if (isUnlimitedToolTimeoutMs(call.policy.toolTimeoutMs)) {
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
  const combined = combineAbortSignals(call.policy.toolTimeoutMs, prev);
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
    permissionModeMiddleware,
    discoveryLoopMiddleware,
    hostFileLoopMiddleware,
    roleAllowlistMiddleware,
    matterScopeMiddleware,
    clarificationGateMiddleware,
    folderExploreGateMiddleware,
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
