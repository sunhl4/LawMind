/**
 * Workspace policy file: `lawmind.policy.json` (same path as desktop server).
 * Phase C adds optional keys for edition, benchmark gates, and governance reporting.
 * Desktop only applies keys it knows; the engine uses the full parsed object for analytics.
 */

import fs from "node:fs";
import path from "node:path";
import { inspectCommercialPolicy } from "./commercial-policy.js";
import type { CommercialPolicyInspection } from "./commercial-policy.js";
import type { LawMindEdition } from "./edition-features.js";

const POLICY_FILENAME = "lawmind.policy.json";

/** Max chars injected into Agent system prompt from policy (inline or file). */
export const AGENT_MANDATORY_RULES_MAX_CHARS = 8192;

/** Product packaging tier (labels, governance defaults). 单一定义见 `edition-features.ts`。 */
export type { LawMindEdition };

/**
 * 出站（egress）总模式。见 `LawMindWorkspacePolicy.egressMode`。
 * 这是「律所级本地部署、全不出站」预留的唯一接口。
 */
export type LawMindEgressMode = "open" | "allowlisted" | "offline";

export const LAWMIND_EGRESS_MODES: readonly LawMindEgressMode[] = [
  "open",
  "allowlisted",
  "offline",
] as const;

/**
 * `lawmind.policy.json` 的 `context` 段（高级设置）。全部可选。
 *
 * 校验与夹取由 `src/lawmind/agent/context-tuning.ts` 统一负责：
 * 类型不对回落默认、越界夹到边界，**绝不抛错**。此处的注释只标默认值与边界。
 *
 * 比例类键的写法：`(0, max]` 表示只夹「明显非法」（非正 / NaN 回落默认，超大夹到
 * max），**不设业务性下限**——合法的极小值（如把触发线压到 0.02 以强制触发）必须
 * 原样生效。见 `context-tuning.ts` 的 `RATIO_MIN` 注释。
 */
export type LawMindContextPolicy = {
  // ── 预算 ────────────────────────────────────────────────────────────
  /** 模型窗口（tokens）。默认 128000，夹 [1000, 10_000_000]。 */
  contextTokens?: number;
  /** 摘要输出预留。默认 20000。 */
  summaryOutputTokenReserve?: number;
  /** 压缩缓冲。默认 13000。 */
  autoCompactBufferTokens?: number;
  /** 连续压缩失败上限。默认 3，夹 [1, 50]。 */
  maxConsecutiveCompactFailures?: number;
  /** 追加上下文注记 / warn 的起始填充比。默认 0.85，夹 (0, 1]；再夹到 ≤ 压缩触发线。 */
  warnRatio?: number;
  /** 回合内压缩触发线（占有效窗口比例）。默认 0.9，夹 (0, 1]。 */
  midTurnCompactTriggerRatio?: number;
  /** 小窗口预留上限（占窗口比例）。默认 0.25，夹 (0, 0.9]。 */
  smallWindowReserveRatio?: number;
  /** 有效窗口下限（tokens）。默认 8000。 */
  minEffectiveLimitTokens?: number;
  /** 模型窗口下限（tokens）。默认 8000。 */
  minContextTokens?: number;

  /** 回合内整理 / 反弹 / 就地省略 / 模型摘要。 */
  midTurn?: {
    /** 单回合最多整理几次。默认 3，夹 [1, 20]。 */
    maxPerTurn?: number;
    /** 退让反弹上限。默认 2，夹 [0, 10]。 */
    deferralBounceMax?: number;
    /** 就地省略保护的尾部条数。默认 2，夹 [0, 50]。 */
    elideKeepTail?: number;
    /** 就地省略门槛（占有效窗口比例）。默认 0.125，夹 (0, 1]。 */
    elideThresholdRatio?: number;
    /** 就地省略门槛下限（字符）。默认 4000。 */
    elideThresholdMinChars?: number;
    /** 回合内模型摘要起始素材量（字符）。默认 600。 */
    llmDigestMinChars?: number;
    /** 回合内模型摘要超时（毫秒）。默认 15000，夹 [500, 600000]。 */
    llmDigestTimeoutMs?: number;
  };

  /** 提取式 / 模型摘要的额度与帽。 */
  digest?: {
    /** 摘要额度 = 窗口 × 该比例。默认 0.08，夹 (0, 0.5]。 */
    charRatio?: number;
    /** 摘要额度下限。默认 6000。 */
    minChars?: number;
    /** 摘要额度上限。默认 24000。 */
    maxChars?: number;
    /** 任务陈述段落额度。默认 0.25，夹 (0, 0.9]。 */
    taskRatio?: number;
    taskMinChars?: number;
    taskMaxChars?: number;
    /** 律师要点单行额度。默认 0.06，夹 (0, 0.5]。 */
    lawyerLineRatio?: number;
    lawyerLineMinChars?: number;
    lawyerLineMaxChars?: number;
    /** 旧策略仍接受。整理稿不再把上一轮摘要嵌进提示。 */
    carriedRatio?: number;
    /** 接续额度的绝对下限（字符）。默认 400，夹 [100, 100000]。 */
    carriedMinChars?: number;
    /** 任务陈述候选上限（条）。默认 2，夹 [1, 20]。 */
    taskLineMax?: number;
    /** 律师要点 / 助手结论各保留最近条数。默认 8，夹 [1, 50]。 */
    recentLineKeep?: number;
    /** 被丢弃区段的法条锚点召回上限。默认 24。 */
    citationAnchorMax?: number;
    /** LLM 摘要可用长度下限。默认 40。 */
    llmMinSummaryChars?: number;
    /** LLM 摘要头部占比。默认 0.45，夹 (0, 0.9]。 */
    llmSummaryShare?: number;
    /** LLM 摘要总开关（默认 true；env `LAWMIND_COMPACT_LLM` 仍可一刀切关掉）。 */
    llmDigestEnabled?: boolean;
  };

  /** 任务锚点（钉子）与事实台账（律师原话钉住）。 */
  pins?: {
    /** 任务锚点字符上限。默认 600，夹 [50, 10000]。 */
    taskCharCap?: number;
    /** 事实台账总开关。默认 true。 */
    factEnabled?: boolean;
    /** 台账条数上限。默认 12，夹 [0, 100]。 */
    factMaxItems?: number;
    /** 台账单条字符上限。默认 160。 */
    factItemCharCap?: number;
    /** 台账总字符上限。默认 1200。 */
    factTotalCharCap?: number;
    /** 台账召回法条锚点上限。默认 8。 */
    factCitationAnchorMax?: number;
  };

  /** 另起新对话（带上文）的续接种子。 */
  carryover?: {
    /** 种子额度 = 窗口 × 该比例。默认 0.1，夹 (0, 0.5]。 */
    seedCharRatio?: number;
    seedMinChars?: number;
    seedMaxChars?: number;
    /** 蒸馏正文占额度的比例。默认 0.6，夹 [0.05, 0.9]（过大会把状态头/指针挤没）。 */
    digestShare?: number;
    /** 蒸馏正文额度的绝对下限（字符）。默认 1000，夹 [100, 500000]。 */
    digestMinChars?: number;
    /** 状态头 + 指针的最低额度。默认 500。 */
    frameMinChars?: number;
    /** 「续接来源」卡片摘要预览长度。默认 400。 */
    digestPreviewChars?: number;
    /** 建议另起新对话的压缩次数门槛。默认 2。 */
    suggestMinCompacts?: number;
  };
};

/**
 * Parsed `lawmind.policy.json`.
 * `schemaVersion` >= 1 is required; other fields optional.
 */
export type LawMindWorkspacePolicy = {
  schemaVersion: number;
  description?: string;
  allowWebSearch?: boolean;
  retrievalMode?: string;
  enableCollaboration?: boolean;
  /** Phase C: edition for UI / reports (case-insensitive at resolve time). */
  edition?: LawMindEdition;
  /**
   * Per-feature overrides on top of the edition table (`src/lawmind/policy/edition-features.ts`).
   * Only known `EditionFeatureKey` booleans apply; unknown keys are ignored.
   * Dedicated surfaces (`wordAddinAutoRun`, `ethicsWall.enabled`, …) still win for those capabilities.
   */
  features?: Partial<Record<string, boolean>>;
  /** Phase C: minimum mean benchmark score (0–1) for release / CI gate */
  benchmarkGateMinScore?: number;
  /** Phase C: hint for audit export cadence (e.g. P7D) — documentation-first */
  auditExportCadenceHint?: string;
  /**
   * Short markdown/plaintext rules always prepended to Agent system prompt (after core principles).
   * If `agentMandatoryRulesPath` is set and resolves to a readable file, file content wins; otherwise this field is used.
   */
  agentMandatoryRules?: string;
  /**
   * Path relative to workspace root (no `..`). File must be UTF-8 text; content is capped at AGENT_MANDATORY_RULES_MAX_CHARS.
   */
  agentMandatoryRulesPath?: string;
  /**
   * Cap on Agent `runTurn` tool-call iterations (default `DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN`,
   * or env `LAWMIND_AGENT_MAX_TOOL_CALLS`). When set, must be a positive integer (clamped to 80).
   */
  agentMaxToolCallsPerTurn?: number;
  /**
   * W10：是否采集产品级洞察事件（ux.matter_action）。
   *   - "off"：完全不写新 kind；现有 ui.matter_action 仍写。
   *   - "local-only"（默认）：双写 ux.matter_action，仅本地存储。
   *   - "synced"：双写并允许后续上传 / 跨案件聚合（当前语义与 local-only 一致，季末再决定）。
   * Solo edition 默认 "local-only"。
   */
  productInsightsCollection?: "off" | "local-only" | "synced";
  /**
   * Allowed outbound hostnames for web search / statute search (cLawyer-style).
   * Empty or omitted = no extra restriction beyond edition defaults.
   */
  networkAllowlist?: string[];
  /** When true, web search tools require a non-empty networkAllowlist in firm/strict modes. */
  networkAllowlistEnforced?: boolean;
  /**
   * Allowed recipient email domains for prepare_outbound_mail (e.g. `["client.com"]`).
   * Empty or omitted = no extra domain restriction (privilege sentinel still applies).
   */
  outboundAllowedDomains?: string[];
  /**
   * 对话窗口：200K（默认）/ 500K / 1M。旧值 `daily` / `dossier` 读入时分别视为 200K / 1M。
   * 实际长度见 `context-preset.ts`：不超过模型自己的窗口。
   */
  conversationLength?: "200k" | "500k" | "1m";
  /**
   * Word 修订署名。空白或不写时，审阅稿上的修订作者是 LawMind。
   * 设置页写入；导出时交给 officecli 的 `revision.author`。
   */
  wordRevisionAuthor?: string;
  /**
   * 上下文窗口 / 自动压缩 / 摘要 / 钉子 / 续接的调参（高级设置）。
   *
   * 全部可选；**每一项都做类型校验与夹取**，非法值回落默认、越界值夹到边界
   * （绝不因为写错一个数就让采样路径炸）。解析入口是
   * `src/lawmind/agent/context-tuning.ts` 的 `resolveContextTuning`；
   * 生效值与「显式写过的键」可在体检页与 `GET /api/sessions/:id/context-budget`
   * 的 `tuning` / `tuningOverrides` 里核对。
   */
  context?: LawMindContextPolicy;
  /**
   * 出站（egress）总模式——**私有化 / 律所内网部署的唯一权威开关**。
   *
   * - `"offline"`：完全不出站。法规检索、公开网页、URL 卷宗、MCP 客户端、分析脚本一律关闭。
   *   律所级本地部署（本地模型 + 全离线）用这个；需要时可再放开 `allowlisted`。
   * - `"allowlisted"`：只放行 `networkAllowlist` 里的主机（推荐：只列官方法规站）。
   * - `"open"`：不额外加限制（仍受 edition 与非空 allowlist 约束）。
   *
   * 缺省按 `networkAllowlist` 推导：非空即 `allowlisted`，否则 `open`。
   * 与 `allowWebSearch` 的关系是**上限 vs 偏好**：本模式为 `offline` 时联网强制关闭，
   * 但**不改写** `allowWebSearch`，所以退出离线模式后律师原偏好自动恢复。见 `resolveEgressMode`。
   */
  egressMode?: LawMindEgressMode;
  /**
   * @deprecated 旧「高安全模式」键，等价于 `egressMode: "offline"`。
   * 仅为兼容既有 `lawmind.policy.json` 保留；新配置请写 `egressMode`。
   */
  highSecurityMode?: boolean;
  /**
   * 允许 run_analysis 运行预置/律师确认的脚本文件。缺省允许。
   * 只有显式 `false` 或离线模式才关闭。日常核算走 run_compute，不依赖本键。
   */
  allowAnalysisScripts?: boolean;
  /**
   * P2：高风险工具在子进程内执行（POC）。也可用 `LAWMIND_TOOL_SANDBOX=1`。
   * 默认关闭。
   */
  toolSandbox?: boolean;
  /**
   * P5：外部判定模型（判断层用，不是对话模型）。
   * - `"off"` / 未写：**默认关闭**（不存在「配了 key 就自动开」）
   * - `"shadow"`：判定的结果只作对照记录，不参与决策
   * - `"on"`：结果可参与决策（仍受 `egressMode: "offline"` 一票否决）
   *
   * 与 `egressMode` 的关系是**独立的**：离线模式下本项**无条件不可用**。
   * 见 `models/decision-model.ts` 的 ① 号规则。
   */
  decisionModelMode?: "off" | "shadow" | "on";
  /** 判定模型端点（OpenAI 兼容之外的协议，如 TypeSafe systemone）。 */
  decisionModelBaseUrl?: string;
  /** 判定模型 key。建议走环境变量 `LAWMIND_DECISION_MODEL_API_KEY`，勿写进文件。 */
  decisionModelApiKey?: string;
  /** 判定模型 id，如 `jev-latest`。 */
  decisionModelId?: string;
  /**
   * P4：判断项从 advisory 升 blocking 的门槛（误报率优先，见 `delivery/judgement-ratchet.ts`）。
   */
  judgementPromotion?: {
    minSamples?: number;
    maxFalsePositiveRate?: number;
  };
  /**
   * P2.3/P2.4：三路径分歧记录与升级姿态。
   * - `routeDivergenceShadow: false` 是**主开关**（关掉即整套 off，连记录都不做）
   * - `routeDivergencePosture`: `"off" | "shadow" | "escalate"`（默认 `"shadow"`：只记录）
   */
  routeDivergenceShadow?: boolean;
  routeDivergencePosture?: "off" | "shadow" | "escalate";
  /**
   * G0：判据分级三态（`off` | `shadow` | `on`）。**缺省 `shadow`**（只记录一致率，行为不变）。
   * 未设时读 `LAWMIND_JUDGMENT_TIERING`。见 `policy/judgment-tiering.ts`。
   */
  judgmentTiering?: "off" | "shadow" | "on";
  /**
   * G0：被停用的机器验证器 id（自动回滚用）。被停用的项**降回 `judge`**，不是失效放行。
   * 未设时读 `LAWMIND_JUDGMENT_DISABLED_VERIFIERS`（逗号分隔）。未知 id 静默忽略。
   */
  judgmentDisabledVerifiers?: string[];
  /**
   * G3：律师升级通道（`off` | `on`）。**缺省 `off`**——判据分级还在 shadow 期，通道与 `on` 必须一起开。
   * 未设时读 `LAWMIND_JUDGMENT_ESCALATION`。
   */
  judgmentEscalation?: "off" | "on";
  /**
   * G3：升级卡姿态（`advisory` | `block`）。缺省随 edition：solo → `advisory`，
   * firm / private_deploy → `block`。未设时读 `LAWMIND_JUDGMENT_ESCALATION_POSTURE`。
   *
   * `block` 会把卡片并进 `requiresAction`（在对话里停下等确认）；`advisory` 不打断，
   * 卡片只在改稿台旁路展示。
   */
  judgmentEscalationPosture?: "advisory" | "block";
  /**
   * P2：律所团队记忆云同步（opt-in，默认关闭）。仅 `edition: firm` 且 `enabled: true` 时生效。
   */
  teamMemorySync?: {
    enabled?: boolean;
    endpoint?: string;
  };
  /**
   * 案件副本协作（多人共办一案）。
   * - enabled: 覆盖 edition 默认（各版本默认开；false 可关掉）
   * - endpoint: 预留托管案件云 URL（尚未强制）
   * - sharedRelayDir: 可选共享目录中继（两台 LawMind 指向同一文件夹即可交换 ops）
   */
  matterReplica?: {
    enabled?: boolean;
    endpoint?: string;
    sharedRelayDir?: string;
    /** On-disk Matter Cloud root (default: workspace/lawmind/replica-cloud). */
    cloudDataDir?: string;
    /** Optional bearer for remote Matter Cloud HTTP. */
    cloudToken?: string;
    /** 后台自动同步（轮询 + 共享中继监听）。缺省：门控开启即开。 */
    autoSync?: boolean;
  };
  /**
   * Firm 伦理墙。缺省跟 edition：Firm / 私有化开，Solo 关。
   * enabled: true 可在 Solo 强制开；false 可在 Firm 强制关。
   */
  ethicsWall?: {
    enabled?: boolean;
  };
  /** Memory recall tuning (Claude Code–style small-file preference). */
  memoryRecall?: {
    /** Boost manifest entries under `smallFileMaxBytes` when ranking. */
    preferSmallFiles?: boolean;
    smallFileMaxBytes?: number;
  };
  /**
   * Skills E4：引用模式。
   * - grounded：无源/未锚定长段阻断 strict 导出
   * - assisted（Solo 默认）：缺源阻断导出，未锚定仅提示
   * - off：不因引用阻断
   * 也可用环境变量 `LAWMIND_CITATION_MODE`。
   */
  citationMode?: "grounded" | "assisted" | "off";
  /**
   * System prompt tool catalogue verbosity.
   * - compact（默认）：核心工具短列表（省 context）
   * - full：完整工具参数列表
   * 也可用 `LAWMIND_PROMPT_VERBOSITY=compact|full`。
   */
  agentPromptVerbosity?: "compact" | "full";
  /**
   * When false, skip intake-first clarification heuristics (Doctor / power users).
   * Also `LAWMIND_INTAKE=0`.
   */
  intakeHeuristicsEnabled?: boolean;
  /**
   * true 时本地服务定时器会在索引缺失/过期（>24h）时自动轻量重建 FTS 索引。
   * 默认关闭（false/缺省）——重建仍需手动（Doctor）或启动缺失兜底。
   */
  searchIndexAutoRebuild?: boolean;
  /**
   * Whether the model must emit「本轮已应用」footer for executable preferences.
   * - first（默认）：仅会话首轮要求
   * - always：每轮要求
   * - off：不要求（system 仍列出偏好）
   */
  appliedPreferencesFooter?: "always" | "first" | "off";
  /**
   * When false, skip the ESG/report auto `execute_workflow` short-circuit (fall through to model loop).
   * Also `LAWMIND_AUTO_DELIVERABLE_WF=0`. Default true.
   */
  autoDeliverableWorkflow?: boolean;
  /**
   * Soft cap on conversation history messages before compact-by-count (F6).
   * Overrides capability-envelope default when set (clamped 8–200).
   */
  agentMaxHistoryMessages?: number;
  /**
   * Solo / opt-in: pre-approve sandbox workflow steps with `__approved` (C3).
   * Firm edition still respects strictDangerousToolApproval. Never auto-approves render.
   * Default false.
   */
  autoApproveSandboxWorkflowSteps?: boolean;
  /**
   * 带修订轨的稿子是否「不过独立审稿就不许导出」。
   * 缺省 `advisory`（审稿照跑、缺口如实交出，但不阻断导出）；`block` 恢复硬墙。
   */
  guardianTrackedRedline?: "block" | "advisory";
  /**
   * Word 插件「审这份」后由桌面端自动取件并跑审查。
   * 未设时随 edition（`wordAddinAutoRun`：solo 默认开，firm/private 默认关）。
   */
  wordAddinAutoRun?: boolean;
  /** When false, skip privilege-sentinel preflight on compose / outbound mail. */
  privilegeSentinel?: boolean;
  /**
   * W2-3：分级交付。全部可选；缺省保守（外发永不自动交付）。
   * medium → one_tap_signoff；high → full_review；
   * auto_deliver 仅当渐进自主已解锁且 low 且非外发。
   */
  delivery?: {
    description?: string;
    /** When true, every draft is full_review (firm / IT override). */
    firmForceFullReview?: boolean;
  };
  /**
   * W2-3：渐进自主阈值。缺省 minFirstPassRate 0.8、minSamples 20、maxLintEscapeRate 0.15。
   * 缺 lint-escape 序列时不得解锁（仅一次通过不足）。
   */
  progressiveAutonomy?: {
    description?: string;
    minFirstPassRate?: number;
    minSamples?: number;
    maxLintEscapeRate?: number;
  };
  /** 本机能力（Host Access）。缺省见 resolveHostAccessPolicy。 */
  hostAccess?: import("../host-access/types.js").HostAccessPolicyConfig;
};

export function resolveAgentMaxHistoryMessages(
  workspaceDir: string,
  envelopeDefault: number,
): number {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const fromPolicy =
    policy &&
    typeof policy.agentMaxHistoryMessages === "number" &&
    Number.isFinite(policy.agentMaxHistoryMessages)
      ? Math.floor(policy.agentMaxHistoryMessages)
      : undefined;
  const base = fromPolicy !== undefined ? fromPolicy : envelopeDefault;
  return Math.min(200, Math.max(8, base));
}

export function resolveAgentPromptVerbosity(
  policy: LawMindWorkspacePolicy | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): "compact" | "full" {
  const envRaw = env.LAWMIND_PROMPT_VERBOSITY?.trim().toLowerCase();
  if (envRaw === "compact" || envRaw === "full") {
    return envRaw;
  }
  if (policy?.agentPromptVerbosity === "compact" || policy?.agentPromptVerbosity === "full") {
    return policy.agentPromptVerbosity;
  }
  return "compact";
}

export function resolveAppliedPreferencesFooterMode(
  policy: LawMindWorkspacePolicy | null | undefined,
): "always" | "first" | "off" {
  const mode = policy?.appliedPreferencesFooter;
  if (mode === "always" || mode === "first" || mode === "off") {
    return mode;
  }
  return "first";
}

export type ResolvedAgentMandatoryRules = {
  active: boolean;
  truncated: boolean;
  text: string;
};

function isSafeRelativeWorkspacePath(rel: string): boolean {
  const t = rel.trim();
  if (!t || t.length > 512) {
    return false;
  }
  const norm = path.normalize(t);
  if (path.isAbsolute(norm)) {
    return false;
  }
  return !norm.split(path.sep).some((p) => p === "..");
}

function resolvePathUnderWorkspace(workspaceDir: string, rel: string): string | null {
  if (!isSafeRelativeWorkspacePath(rel)) {
    return null;
  }
  const root = path.resolve(workspaceDir);
  const full = path.resolve(root, rel);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return null;
  }
  return full;
}

/**
 * Resolve mandatory Agent rules from workspace policy (inline or file under workspace).
 * Invalid paths or missing files fall back to inline `agentMandatoryRules` only.
 */
export function resolveAgentMandatoryRulesForPrompt(
  workspaceDir: string,
  policy: LawMindWorkspacePolicy | null,
): ResolvedAgentMandatoryRules {
  if (!policy) {
    return { active: false, truncated: false, text: "" };
  }

  const pathRel =
    typeof policy.agentMandatoryRulesPath === "string" ? policy.agentMandatoryRulesPath.trim() : "";
  const inline =
    typeof policy.agentMandatoryRules === "string" ? policy.agentMandatoryRules.trim() : "";

  let raw = "";

  if (pathRel) {
    const abs = resolvePathUnderWorkspace(workspaceDir, pathRel);
    if (abs && fs.existsSync(abs)) {
      try {
        const st = fs.statSync(abs);
        if (st.isFile()) {
          raw = fs.readFileSync(abs, "utf8").trim();
        }
      } catch {
        raw = "";
      }
    }
    if (!raw && inline) {
      raw = inline;
    }
  } else {
    raw = inline;
  }

  if (!raw) {
    return { active: false, truncated: false, text: "" };
  }

  let truncated = false;
  if (raw.length > AGENT_MANDATORY_RULES_MAX_CHARS) {
    truncated = true;
    raw = raw.slice(0, AGENT_MANDATORY_RULES_MAX_CHARS);
  }

  return { active: true, truncated, text: raw };
}

/**
 * Matter-scoped hard rules: `matters/<id>/RULES.md` or `cases/<id>/RULES.md`.
 * Same size cap as workspace mandatory rules.
 */
export function resolveMatterMandatoryRulesForPrompt(
  workspaceDir: string,
  matterId: string | undefined,
): ResolvedAgentMandatoryRules {
  const id = typeof matterId === "string" ? matterId.trim() : "";
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return { active: false, truncated: false, text: "" };
  }
  const root = path.resolve(workspaceDir);
  const candidates = [
    path.join(root, "matters", id, "RULES.md"),
    path.join(root, "cases", id, "RULES.md"),
  ];
  let raw = "";
  for (const abs of candidates) {
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        raw = fs.readFileSync(abs, "utf8").trim();
        if (raw) {
          break;
        }
      }
    } catch {
      /* try next */
    }
  }
  if (!raw) {
    return { active: false, truncated: false, text: "" };
  }
  let truncated = false;
  if (raw.length > AGENT_MANDATORY_RULES_MAX_CHARS) {
    truncated = true;
    raw = raw.slice(0, AGENT_MANDATORY_RULES_MAX_CHARS);
  }
  return { active: true, truncated, text: raw };
}

function parsePolicy(raw: string): LawMindWorkspacePolicy | null {
  try {
    return inspectCommercialPolicy(JSON.parse(raw) as unknown).policy;
  } catch {
    return null;
  }
}

/** 读策略文件并给出拒绝 / 迁移说明。文件不存在时 policy 为 null、rejected 为空。 */
export function inspectWorkspacePolicyFile(workspaceDir: string): CommercialPolicyInspection & {
  present: boolean;
} {
  const abs = path.join(path.resolve(workspaceDir), POLICY_FILENAME);
  if (!fs.existsSync(abs)) {
    return { present: false, policy: null, rejected: [], migrated: [] };
  }
  try {
    const raw = fs.readFileSync(abs, "utf8");
    return { present: true, ...inspectCommercialPolicy(JSON.parse(raw) as unknown) };
  } catch {
    return {
      present: true,
      policy: null,
      rejected: [{ key: "(file)", reason: "JSON 无法解析，整份未生效" }],
      migrated: [],
    };
  }
}

/**
 * Read `lawmind.policy.json` from the workspace root (no env mutation).
 * Returns `null` if missing or invalid.
 */
export function readWorkspacePolicyFile(workspaceDir: string): LawMindWorkspacePolicy | null {
  const abs = path.join(path.resolve(workspaceDir), POLICY_FILENAME);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const raw = fs.readFileSync(abs, "utf8");
  return parsePolicy(raw);
}

export function workspacePolicyPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), POLICY_FILENAME);
}

/**
 * 解析有效出站模式（纯函数）。
 *
 * 优先级：显式 `egressMode` > 旧 `highSecurityMode` > `networkAllowlist` 推导。
 * 只读不写：调用方**不得**为了让联网关闭而回写 `allowWebSearch`，否则退出离线模式后
 * 律师的联网偏好已经被抹掉（历史 bug：`PATCH /api/policy/workspace` 曾静默写 false）。
 */
export function resolveEgressMode(
  policy:
    | Pick<LawMindWorkspacePolicy, "egressMode" | "highSecurityMode" | "networkAllowlist">
    | null
    | undefined,
): LawMindEgressMode {
  if (!policy) {
    return "open";
  }
  if (
    policy.egressMode === "offline" ||
    policy.egressMode === "allowlisted" ||
    policy.egressMode === "open"
  ) {
    return policy.egressMode;
  }
  // 兼容旧键：高安全模式等价于完全不出站。
  if (policy.highSecurityMode === true) {
    return "offline";
  }
  const list = Array.isArray(policy.networkAllowlist)
    ? policy.networkAllowlist.map((x) => x.trim()).filter(Boolean)
    : [];
  return list.length > 0 ? "allowlisted" : "open";
}

/** 读取工作区策略并解析出站模式（无 env 副作用）。 */
export function readEgressMode(workspaceDir: string): LawMindEgressMode {
  return resolveEgressMode(readWorkspacePolicyFile(workspaceDir));
}

/**
 * 是否处于「完全不出站」的离线模式（律所级本地部署）。
 * 供 `isHighSecurityMode` / MCP 客户端 / run_compute 等共用同一个判断。
 */
export function isEgressOffline(workspaceDir: string): boolean {
  return readEgressMode(workspaceDir) === "offline";
}

/** Merge patch into `lawmind.policy.json` (creates file with schemaVersion 1 if missing). */
export function mergeWorkspacePolicyFile(
  workspaceDir: string,
  patch: Partial<LawMindWorkspacePolicy>,
): { ok: true; policy: LawMindWorkspacePolicy } | { ok: false; error: string } {
  const abs = workspacePolicyPath(workspaceDir);
  const existing = readWorkspacePolicyFile(workspaceDir) ?? { schemaVersion: 1 };
  const merged: LawMindWorkspacePolicy = {
    ...existing,
    ...patch,
    schemaVersion: existing.schemaVersion >= 1 ? existing.schemaVersion : 1,
    hostAccess:
      patch.hostAccess || existing.hostAccess
        ? { ...existing.hostAccess, ...patch.hostAccess }
        : existing.hostAccess,
  };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return { ok: true, policy: merged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const MAX_TOOL_CALLS_CAP = 80;

/** Keep in sync with `DEFAULT_SOFT_TOOL_CALLS` in `src/lawmind/agent/tool-budget.ts`. */
export const DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN = 80;

/**
 * Effective max tool iterations per Agent turn: `lawmind.policy.json` overrides env when set.
 */
export function resolveAgentMaxToolCallsPerTurn(workspaceDir: string): number {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const fromPolicy =
    policy &&
    typeof policy.agentMaxToolCallsPerTurn === "number" &&
    Number.isFinite(policy.agentMaxToolCallsPerTurn) &&
    policy.agentMaxToolCallsPerTurn > 0
      ? Math.floor(policy.agentMaxToolCallsPerTurn)
      : undefined;
  const envRaw = process.env.LAWMIND_AGENT_MAX_TOOL_CALLS?.trim();
  const envParsed = envRaw ? Math.floor(Number(envRaw)) : NaN;
  const fromEnv = Number.isFinite(envParsed) && envParsed > 0 ? envParsed : undefined;
  /** Default raised so complex legal turns are less likely to stop mid-task. */
  const base =
    fromPolicy !== undefined ? fromPolicy : (fromEnv ?? DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN);
  return Math.min(MAX_TOOL_CALLS_CAP, Math.max(1, base));
}
