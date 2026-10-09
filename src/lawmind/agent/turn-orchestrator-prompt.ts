/**
 * System prompt assembly for a single agent turn.
 * Extracted from turn-orchestrator.ts.
 */

import {
  formatCurrentAssistantOrgLine,
  formatTeamOrgOverviewForPrompt,
} from "../assistants/org-prompt.js";
import { buildPeerAssistantsForPrompt } from "../assistants/peer-list.js";
import { readAssistantProfileMarkdown } from "../assistants/profile-md.js";
import {
  getAssistantById,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../assistants/store.js";
import { getRoleById } from "../core/role.js";
import {
  formatGoldenExamplesPromptBlock,
  loadGoldenExamplesForDrafting,
} from "../evaluation/golden-recall.js";
import { buildContractRevisionRecallBlock } from "../learning/contract-revision-recall.js";
import {
  formatEditExamplesPromptBlock,
  loadEditExamplesForDrafting,
} from "../learning/edit-examples.js";
import { formatRejectionCoach } from "../learning/rejection-ratchet.js";
import { resolveMailAccountForMatter } from "../mail/mail-accounts.js";
import { buildMailSendFormatPrompt } from "../mail/mail-send-format.js";
import {
  formatExecutablePreferencesHint,
  loadExecutablePreferences,
} from "../memory/executable-preferences.js";
import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import {
  lawyerProfileForPrompt,
  profileWithoutAccumulation,
  windowLawyerProfileForPrompt,
} from "../memory/lawyer-profile-for-prompt.js";
import {
  findRelevantMemoriesForTurn,
  formatRelevantMemoryHitsForPrompt,
} from "../memory/relevant-recall.js";
import { resolveCapabilityEnvelope } from "../models/capability-envelope.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentPromptVerbosity,
  resolveAppliedPreferencesFooterMode,
  resolveMatterMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import {
  formatDerivedFactsPromptBlock,
  loadDerivedFactsForMatter,
} from "../reasoning/derived-facts.js";
import { buildAuthorityCorpusSummary } from "../retrieval/authority-health.js";
import { isAuthorityLive, isAuthorityOfficialPublic } from "../retrieval/authority-source-tier.js";
import { deliverableTypeFromInstruction, isHighRiskEmptyRunType } from "../router/intake-gate.js";
import { buildContextPlan, buildContextPlanMarkdown } from "../runtime/context-plan.js";
import { resolvePinnedContextSummary, withContractPlaybookPin } from "../runtime/pinned-context.js";
import { formatStanceHint } from "../stance/inject.js";
import { getAssistantPreset } from "./assistant-presets.js";
import { buildDeliverablePipelineSystemNote } from "./deliverable-pipeline.js";
import {
  MATERIALS_BLOCK_CAP_TOKENS,
  MATERIALS_FRAGMENT_KIND,
  MATERIALS_FRAGMENT_PRIORITY,
  composeMaterialsBlock,
  recordMaterialBlockEvent,
} from "./material-blocks.js";
import { NO_TASK_TURN_PROMPT } from "./no-task-turn.js";
import type { AgentPermissionMode } from "./permission-mode.js";
import {
  capFragmentBody,
  createPromptFragment,
  FRAGMENT_SESSION_TAIL_BUDGET_TOKENS,
  packPromptFragments,
  partitionPackedFragments,
  renderPackedFragments,
  scaleFragmentCapTokens,
  type PromptFragment,
  type PromptFragmentKind,
  type PromptOverflow,
} from "./prompt-fragments.js";
import { applySystemPromptToHistory, buildSystemPrompt } from "./system-prompt.js";
import { promptCatalogToolNames } from "./tools/governance.js";
import { enableableToolCatalog } from "./tools/legal/list-more-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import { formatTurnPlanWorldState } from "./turn-plan.js";
import type { AgentConfig, AgentContext, AgentSession } from "./types.js";
import {
  collectWorldStateHashes,
  formatMatterWorldState,
  formatPermissionWorldState,
  stabilizeUnchangedWorldState,
  WORLD_STATE_SECTION_IDS,
  type WorldStateSectionId,
} from "./world-state.js";

function todayMemoryLogRel(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `memory/${yyyy}-${mm}-${dd}.md`;
}

function queueFragment(
  fragments: PromptFragment[],
  kind: PromptFragmentKind,
  body: string | undefined,
  opts?: {
    worldStateId?: WorldStateSectionId;
    overflow?: PromptOverflow | null;
    capTokens?: number;
    priority?: number;
    windowScale?: number;
  },
): void {
  const fragment = createPromptFragment({
    kind,
    body: body ?? "",
    overflow: opts?.overflow ?? null,
    worldStateId: opts?.worldStateId,
    capTokens: opts?.capTokens,
    priority: opts?.priority,
    windowScale: opts?.windowScale,
  });
  if (fragment) {
    fragments.push(fragment);
  }
}

export type AssistantTooling = {
  assistantProfileMarkdown: string;
  presetForTools: ReturnType<typeof getAssistantPreset> | undefined;
  roleForTools: ReturnType<typeof getRoleById> | undefined;
};

/**
 * 解析当前助手的岗位/预设（含工具白名单口径）。runTurn 在构建 prompt 前调用：
 * 「本轮生效工具集」必须先于 system prompt 定稿，prompt 工具目录才与之同源。
 */
export function resolveAssistantTooling(opts: {
  workspaceDir: string;
  resolvedAssistantId?: string;
}): AssistantTooling {
  let assistantProfileMarkdown = "";
  let presetForTools: AssistantTooling["presetForTools"];
  let roleForTools: AssistantTooling["roleForTools"];
  if (opts.resolvedAssistantId) {
    try {
      const lawMindRootForProfile = resolveLawMindRoot(opts.workspaceDir);
      assistantProfileMarkdown = readAssistantProfileMarkdown(
        lawMindRootForProfile,
        opts.resolvedAssistantId,
      );
      const prof = getAssistantById(lawMindRootForProfile, opts.resolvedAssistantId);
      presetForTools = getAssistantPreset(prof?.presetKey);
      // W7：优先用 Role；过渡期回退到 preset。
      roleForTools = getRoleById(prof?.roleId ?? prof?.presetKey);
    } catch {
      assistantProfileMarkdown = "";
    }
  }
  return { assistantProfileMarkdown, presetForTools, roleForTools };
}

export async function prepareTurnPromptContext(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  session: AgentSession;
  instruction: string;
  resolvedAssistantId: string | undefined;
  linkedTaskIdForCtx: string | undefined;
  projectDirResolved: string | undefined;
  contextPins?: ComposeContextPin[];
  permissionMode?: AgentPermissionMode;
  /**
   * 本轮生效工具集（已经权限模式/角色/playbook lock/隐藏策略过滤）。
   * 提供时「可用工具」一节由该集合生成：prompt 广告清单与管线可执行集单一真相源。
   * 缺省回退到核心目录（仅供测试与无过滤场景）。
   */
  availableToolNames?: string[];
  /** 调用方已解析的助手岗位/预设（避免重复读助手档案）。 */
  assistantTooling?: AssistantTooling;
  compiledIntent?: import("../intent/types.js").CompiledIntent;
  /**
   * Codex 对齐：本轮原话不构成任务（单字 / 纯确认 / 空）。
   * 不注入上一轮清单，并明确禁止重启办件流水线（写工具已在 tool-pipeline 关闭）。
   */
  noTaskTurn?: boolean;
}): Promise<{
  memory: MemoryContext;
  systemPromptFinal: string;
  presetForTools: ReturnType<typeof getAssistantPreset> | undefined;
  roleForTools: ReturnType<typeof getRoleById> | undefined;
  lawMindRoot: string;
}> {
  const {
    config,
    registry,
    session,
    instruction,
    resolvedAssistantId,
    linkedTaskIdForCtx,
    projectDirResolved,
  } = opts;

  const pinnedContextSummary = resolvePinnedContextSummary({
    workspaceDir: config.workspaceDir,
    projectDir: projectDirResolved,
    pins: withContractPlaybookPin(opts.contextPins, instruction),
  });

  const memory = await loadMemoryContext(config.workspaceDir, { matterId: session.matterId });

  const { assistantProfileMarkdown, presetForTools, roleForTools } =
    opts.assistantTooling ??
    resolveAssistantTooling({
      workspaceDir: config.workspaceDir,
      resolvedAssistantId,
    });

  let peerAssistants: Array<{ id: string; displayName: string; roleTitle: string }> | undefined;
  let peerAssistantsBusy: Array<{ id: string; displayName: string; roleTitle: string }> | undefined;
  let teamOrgOverview: string | undefined;
  let assistantOrgLine: string | undefined;
  const lawMindRoot = resolveLawMindRoot(config.workspaceDir, config.envFile);
  try {
    const allProfiles = loadAssistantProfiles(lawMindRoot);
    teamOrgOverview = formatTeamOrgOverviewForPrompt(allProfiles);
    if (resolvedAssistantId) {
      const me = getAssistantById(lawMindRoot, resolvedAssistantId);
      assistantOrgLine = formatCurrentAssistantOrgLine(me, allProfiles);
    }
  } catch (err) {
    console.error("[lawmind] team org overview failed:", err);
    teamOrgOverview = undefined;
    assistantOrgLine = undefined;
  }
  if (config.enableCollaboration) {
    try {
      const peers = buildPeerAssistantsForPrompt({
        lawMindRoot,
        workspaceDir: config.workspaceDir,
        currentAssistantId: resolvedAssistantId,
      });
      peerAssistants = peers.available;
      peerAssistantsBusy = peers.busy;
    } catch (err) {
      console.error("[lawmind] peer assistants load failed:", err);
      peerAssistants = [];
      peerAssistantsBusy = [];
    }
  }

  const workspacePolicy = readWorkspacePolicyFile(config.workspaceDir);
  const mandatoryRules = resolveAgentMandatoryRulesForPrompt(config.workspaceDir, workspacePolicy);
  const matterMandatoryRules = resolveMatterMandatoryRulesForPrompt(
    config.workspaceDir,
    session.matterId,
  );

  const { resolveIntakeAdvisoryQuestions } = await import("../router/intake-gate.js");
  const hasContextPins = Array.isArray(opts.contextPins) && opts.contextPins.length > 0;
  const intakeAdvisoryQs = resolveIntakeAdvisoryQuestions(instruction, {
    caseMemory: memory.caseMemory,
    intakeHeuristicsEnabled: workspacePolicy?.intakeHeuristicsEnabled,
    hasContextPins,
  });
  // 高风险空跑（函件/诉讼文书且无档案）不再硬停：Soft Ask 文案升级为假设起草。
  const intakeHighRiskEmptyRun =
    intakeAdvisoryQs.length > 0 &&
    isHighRiskEmptyRunType(deliverableTypeFromInstruction(instruction));
  const deliverablePipelineNote = buildDeliverablePipelineSystemNote(instruction);
  const lawyerProfileForSystem = lawyerProfileForPrompt(memory.profile ?? "");
  let kernelMemory = "";
  let kernelReady = false;
  let inactiveBodies: string[] = [];
  let caseInactiveBodies: string[] = [];
  let clientInactiveBodies: string[] = [];
  let omitInactiveLines = (text: string, _bodies: readonly string[]): string => text;
  try {
    const kernel = await import("../memory/kernel/query.js");
    kernelMemory = kernel.formatKernelMemoryForPrompt(config.workspaceDir, {
      matterId: session.matterId,
      query: instruction,
    });
    kernelReady = true;
    inactiveBodies = kernel.terminalMemoryBodies(config.workspaceDir);
    caseInactiveBodies = session.matterId
      ? kernel.terminalMemoryBodies(config.workspaceDir, {
          scope: "matter",
          scopeId: session.matterId,
        })
      : [];
    clientInactiveBodies = memory.clientProfileClientId
      ? kernel.terminalMemoryBodies(config.workspaceDir, {
          scope: "client",
          scopeId: memory.clientProfileClientId,
        })
      : [];
    omitInactiveLines = kernel.omitLinesCarryingBodies;
  } catch (err) {
    console.error("[lawmind] memory kernel prompt failed:", err);
  }
  const profileForPrefs = kernelReady
    ? profileWithoutAccumulation(lawyerProfileForSystem ?? "")
    : (lawyerProfileForSystem ?? "");
  const executablePrefs = loadExecutablePreferences(config.workspaceDir, profileForPrefs, 6).filter(
    (pref) => !inactiveBodies.some((body) => pref.text.includes(body)),
  );
  let appliedPreferencesHint = formatExecutablePreferencesHint(executablePrefs);
  if (kernelMemory) {
    appliedPreferencesHint = appliedPreferencesHint
      ? `${appliedPreferencesHint}\n\n${kernelMemory}`
      : kernelMemory;
  } else if (!kernelReady) {
    const stanceHint = formatStanceHint(config.workspaceDir, { matterId: session.matterId });
    if (stanceHint) {
      appliedPreferencesHint = appliedPreferencesHint
        ? `${appliedPreferencesHint}\n\n${stanceHint}`
        : stanceHint;
    }
  }
  const envelope = resolveCapabilityEnvelope({
    contextTokens: config.model.contextTokens ?? workspacePolicy?.context?.contextTokens,
    timeoutMs: config.model.timeoutMs,
  });
  if (appliedPreferencesHint) {
    appliedPreferencesHint = capFragmentBody(
      appliedPreferencesHint,
      scaleFragmentCapTokens("preference_fingerprint", envelope.promptWindowScale),
      { tool: "read_workspace_file", path: "lawmind/lawyer-preferences.json" },
    );
  }
  const footerMode = resolveAppliedPreferencesFooterMode(workspacePolicy);
  const requireAppliedPreferencesFooter =
    Boolean(appliedPreferencesHint) &&
    (footerMode === "always" || (footerMode === "first" && session.turns.length === 0));
  const agentPromptVerbosity = resolveAgentPromptVerbosity(workspacePolicy);
  const promptCatalog = new Set(promptCatalogToolNames());
  // 单一真相源：调用方传入的本轮生效工具集优先；缺省才回退核心目录。
  const availableNames = opts.availableToolNames ? new Set(opts.availableToolNames) : promptCatalog;
  // 能力菜单：注册表 ∩ 门控 − 本轮已广告。让模型知道「还有什么扳手」，
  // 不必靠中文关键词命中或自己猜到要问 list_more_tools（与目录同一份门控）。
  const enableableTools = enableableToolCatalog({
    allowWebSearch: config.allowWebSearch === true,
    collaborationEnabled: config.enableCollaboration === true,
    workspaceDir: config.workspaceDir,
    registeredNames: registry.listDefinitions().map((def) => def.name),
  }).filter((row) => !availableNames.has(row.name));
  const { scalePromptWindows, truncateForPrompt, windowCaseMarkdownForPrompt } =
    await import("../memory/prompt-windows.js");
  const promptWindow = scalePromptWindows(envelope.promptWindowScale);
  const planCtx: AgentContext = {
    workspaceDir: config.workspaceDir,
    sessionId: session.sessionId,
    matterId: session.matterId,
    actorId: config.actorId ?? session.actorId,
    assistantId: resolvedAssistantId,
    linkedTaskId: linkedTaskIdForCtx,
    projectDir: projectDirResolved,
  };
  const contextPlanMarkdown = buildContextPlanMarkdown(
    buildContextPlan({
      session,
      ctx: planCtx,
      policy: workspacePolicy,
      contextTokens: envelope.contextTokens,
      pinnedContext: pinnedContextSummary,
    }),
  );
  const mailAccount = session.matterId
    ? resolveMailAccountForMatter(config.workspaceDir, session.matterId)
    : null;
  const mailSendFormatHint = mailAccount?.sendFormat
    ? buildMailSendFormatPrompt(mailAccount.sendFormat)
    : undefined;
  const matterRel = session.matterId?.trim()
    ? `cases/${session.matterId.trim()}/CASE.md`
    : undefined;
  const clientRel = memory.clientProfileClientId
    ? `clients/${memory.clientProfileClientId}/CLIENT_PROFILE.md`
    : "CLIENT_PROFILE.md";
  const caseForPrompt = kernelReady
    ? omitInactiveLines(memory.caseMemory ?? "", caseInactiveBodies)
    : (memory.caseMemory ?? "");
  const windowedCase = windowCaseMarkdownForPrompt(
    caseForPrompt,
    promptWindow.matterContextChars,
    matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
  );
  const lawyerFingerprint = kernelMemory
    ? ""
    : windowLawyerProfileForPrompt(
        kernelReady
          ? profileWithoutAccumulation(lawyerProfileForSystem ?? "")
          : (lawyerProfileForSystem ?? ""),
        promptWindow.lawyerFingerprintChars,
        instruction,
      );
  const assistantFingerprint = assistantProfileMarkdown
    ? truncateForPrompt(assistantProfileMarkdown, promptWindow.assistantFingerprintChars, {
        overflow: { tool: "read_workspace_file", path: "assistants" },
      })
    : "";
  const clientForPrompt = kernelReady
    ? omitInactiveLines(memory.clientProfile ?? "", clientInactiveBodies)
    : (memory.clientProfile ?? "");
  const clientFingerprint = truncateForPrompt(
    clientForPrompt,
    promptWindow.clientFingerprintChars,
    {
      overflow: { tool: "read_workspace_file", path: clientRel },
    },
  );
  const matterIndex = truncateForPrompt(windowedCase, promptWindow.matterIndexChars, {
    overflow: matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
  });
  const dayLogIndex = truncateForPrompt(memory.todayLog, promptWindow.dayLogIndexChars, {
    overflow: { tool: "read_workspace_file", path: todayMemoryLogRel() },
  });
  const systemPrompt = buildSystemPrompt({
    availableTools: registry
      .listDefinitions()
      .filter((def) => availableNames.has(def.name))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    enableableTools,
    matterId: session.matterId,
    roleTitle: config.roleTitle,
    roleIntroduction: config.roleIntroduction,
    roleDirective: config.roleDirective,
    roleRiskCeiling: presetForTools?.riskCeiling,
    allowWebSearch: config.allowWebSearch === true,
    authorityLive: isAuthorityLive(),
    authorityOfficialPublic: !isAuthorityLive() && isAuthorityOfficialPublic(),
    authorityProviderLabel: isAuthorityLive()
      ? buildAuthorityCorpusSummary().providerLabel
      : undefined,
    collaborationEnabled: config.enableCollaboration === true,
    peerAssistants,
    peerAssistantsBusy,
    projectDirectoryHint: projectDirResolved,
    linkedTaskId: linkedTaskIdForCtx,
    agentMandatoryRules: mandatoryRules.active ? mandatoryRules.text : undefined,
    agentMandatoryRulesTruncated: mandatoryRules.truncated,
    agentMatterMandatoryRules: matterMandatoryRules.active ? matterMandatoryRules.text : undefined,
    agentMatterMandatoryRulesTruncated: matterMandatoryRules.truncated,
    agentPromptVerbosity,
    requireAppliedPreferencesFooter,
    assistantOrgLine,
    teamOrgOverview,
    runtimeModel: config.runtimeModel,
    appliedPreferencesHint,
    rejectionCoach: formatRejectionCoach(config.workspaceDir, linkedTaskIdForCtx),
    mailSendFormatHint,
  });

  let systemPromptFinal = systemPrompt;
  const fragments: PromptFragment[] = [];
  const queue = (
    kind: PromptFragmentKind,
    body: string | undefined,
    opts?: {
      worldStateId?: WorldStateSectionId;
      overflow?: PromptOverflow | null;
      capTokens?: number;
      priority?: number;
    },
  ) =>
    queueFragment(fragments, kind, body, {
      ...opts,
      windowScale: envelope.promptWindowScale,
    });
  if (lawyerFingerprint) {
    queue("preference_fingerprint", `## 当前律师\n\n${lawyerFingerprint}`, {
      overflow: { tool: "read_workspace_file", path: "LAWYER_PROFILE.md" },
      capTokens: promptWindow.lawyerFingerprintChars,
    });
  }
  if (assistantFingerprint) {
    queue(
      "preference_fingerprint",
      `## 本助手专属偏好（assistants/<id>/PROFILE.md）\n\n${assistantFingerprint}`,
      {
        overflow: { tool: "read_workspace_file", path: "assistants" },
        capTokens: promptWindow.assistantFingerprintChars,
      },
    );
  }
  if (clientFingerprint) {
    queue(
      "preference_fingerprint",
      [
        "## 客户画像（长期合作）",
        "",
        clientFingerprint,
        "",
        "与当前案件档案并用；**单案事实、当事人名称与诉请**以 CASE 与律师明示为准。",
      ].join("\n"),
      {
        overflow: { tool: "read_workspace_file", path: clientRel },
        capTokens: promptWindow.clientFingerprintChars,
      },
    );
  }
  if (session.matterId && matterIndex) {
    queue("matter_index", `## 当前案件 [${session.matterId}]\n\n${matterIndex}`, {
      overflow: matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
      capTokens: promptWindow.matterIndexChars,
    });
  }
  if (session.matterId) {
    // 结构化案件速览（当事人/未决期限/材料/时间线）：继承案件上下文，不占 CASE 窗口。
    const { buildMatterContextFragmentBody } = await import("./matter-context-fragment.js");
    const matterBrief = buildMatterContextFragmentBody({
      workspaceDir: config.workspaceDir,
      matterId: session.matterId,
    });
    if (matterBrief) {
      queue("matter_brief", matterBrief, {
        overflow: matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
      });
    }
  }
  if (dayLogIndex) {
    queue("memory_hit", `## 今日工作记录\n\n${dayLogIndex}`, {
      overflow: { tool: "read_workspace_file", path: todayMemoryLogRel() },
      capTokens: promptWindow.dayLogIndexChars,
    });
  }
  // 相关记忆：零分不注入；命中后写入 alreadySurfaced 避免同会话重复塞同一文件。
  try {
    const alreadySurfaced = new Set(session.alreadySurfacedMemoryPaths ?? []);
    const recentToolNames = Object.keys(session.turns.at(-1)?.toolNameCallCounts ?? {});
    const recallHits = await findRelevantMemoriesForTurn({
      workspaceDir: config.workspaceDir,
      matterId: session.matterId,
      query: instruction,
      alreadySurfaced,
      recentToolNames,
      policy: workspacePolicy,
    });
    const recallBlock = formatRelevantMemoryHitsForPrompt(recallHits);
    if (recallBlock) {
      queue("memory_hit", recallBlock, {
        overflow: { tool: "read_workspace_file", path: "MEMORY.md" },
        capTokens: promptWindow.retrievalMemoryChars,
      });
      const nextSurfaced = [
        ...(session.alreadySurfacedMemoryPaths ?? []),
        ...recallHits.map((h) => h.relativePath),
      ];
      session.alreadySurfacedMemoryPaths = [...new Set(nextSurfaced)].slice(-40);
    }
  } catch (err) {
    console.error("[lawmind] relevant memory recall failed:", err);
  }
  if (contextPlanMarkdown.trim()) {
    queue("protocol", `## 上下文计划（ContextPlan）\n\n${contextPlanMarkdown}`);
  }
  queue("pins", pinnedContextSummary.markdownBlock, { worldStateId: "pins" });
  try {
    const { pinsIncludeXlsx } = await import("./tools/disclosed-turn-tools.js");
    if (pinsIncludeXlsx(opts.contextPins)) {
      queue(
        "protocol",
        [
          "## 表格分析",
          "已钉选电子表格。请先 `analyze_spreadsheet`。",
          "法定金额/期限必须 `calculate`（公式与输入必须带回）。",
          "归并、透视、自定义汇总或从多表出数：用 `run_compute` 写 JS，按报错自修；不要把源码写进给律师的正文。",
          "出图用 `run_compute` 的 emitChart 或 `render_chart`，并在助手正文用 ```lm-chart 围栏原样贴回完整 spec。落表用 `write_spreadsheet` 或 writeTable。",
          "`run_compute` 成功后对照表和意见已进在办；不要只把图画在聊天里，也不必再 draft_document。",
          "数字必须写明来源列。律师只看表、图、结论。不要把整表倒成 TSV。",
        ].join("\n"),
      );
    }
  } catch {
    /* optional */
  }
  try {
    const { formatLocatedWordBaselines } = await import("../runtime/lawyer-local-file.js");
    const located = formatLocatedWordBaselines({
      workspaceDir: config.workspaceDir,
      projectDir: projectDirResolved,
      pins: opts.contextPins,
    });
    queue("pins", located);
  } catch {
    /* optional */
  }
  queue("matter_index", formatMatterWorldState(session.matterId), {
    worldStateId: "matter",
  });
  queue(
    "environment",
    formatPermissionWorldState(opts.permissionMode ?? "standard", {
      allowWebSearch: config.allowWebSearch === true,
    }),
    { worldStateId: "permission" },
  );
  if (opts.noTaskTurn === true) {
    queue("protocol", NO_TASK_TURN_PROMPT);
  } else if (opts.permissionMode === "readonly" || opts.permissionMode === "research") {
    queue(
      "protocol",
      opts.permissionMode === "research"
        ? "## 计划模式（仅调研）\n本回合只能检索、读材料、`update_plan`、`read_skill`。不要起草、改稿或导出。律师点「开始执行」后再写稿。"
        : "## 计划模式\n本回合写工具关闭。先用 `update_plan` 写下要做 / 不要做 / 材料 / 完成，并列出 2–8 步；需要质量规格时调用 `read_skill`。提到文件夹时用 `explore_folder`。不要声称已出稿或任务已完成。律师点「开始执行」后才会开放起草。",
    );
  }
  if (session.turnPlan && opts.noTaskTurn !== true) {
    queue("turn_plan", formatTurnPlanWorldState(session.turnPlan), {
      worldStateId: "plan",
    });
  }
  queue("deliverable", deliverablePipelineNote, { worldStateId: "deliverable" });

  if (session.pendingClarificationKeys?.length) {
    const { selectHardClarificationKeys } = await import("../router/intake-gate.js");
    const hardKeys = selectHardClarificationKeys(session.pendingClarificationKeys);
    if (hardKeys.length > 0) {
      queue(
        "policy",
        [
          "## 未决澄清要点（跨轮保留）",
          "",
          "下列为高风险空跑缺口（函件收件人/主张，或诉讼主体/诉请）。继续时可先用只读/`research_task` 收集材料，但**不得**在缺口未对齐时调用 `draft_document` / `execute_workflow` / `render_document`。",
          "",
          `待确认键：${hardKeys.join(", ")}`,
        ].join("\n"),
        { worldStateId: "policy" },
      );
    }
  }

  try {
    const revisionBlock = await buildContractRevisionRecallBlock({
      workspaceDir: config.workspaceDir,
      instruction,
      matterId: session.matterId,
      limit: 3,
    });
    queue("memory_hit", revisionBlock);
  } catch {
    /* optional recall */
  }

  try {
    const { INTAKE_CRAFT_SKILL, formatIntakeSoftAskBlock } =
      await import("../router/intake-craft.js");
    if (intakeAdvisoryQs.length > 0) {
      queue("craft", INTAKE_CRAFT_SKILL);
      queue(
        "protocol",
        formatIntakeSoftAskBlock(intakeAdvisoryQs, {
          highRiskEmptyRun: intakeHighRiskEmptyRun,
        }),
      );
    }
  } catch {
    /* optional */
  }

  try {
    const { isMailContractFastPathInstruction, MAIL_CONTRACT_FAST_PATH_PROMPT } =
      await import("./mail-contract-fast-path.js");
    if (isMailContractFastPathInstruction(instruction)) {
      queue("craft", MAIL_CONTRACT_FAST_PATH_PROMPT);
    } else {
      const { isWordRevisionTurn, WORD_REVISION_PROMPT } =
        await import("../platform/word-revision-instruction.js");
      const { wordRevisionShouldInjectFamilyChecklist } =
        await import("../intent/document-genre.js");
      const { formatWordRevisionChecklistBlock } =
        await import("../platform/word-revision-checklist.js");
      const { readPinnedWordExcerpt } =
        await import("../platform/word-revision-document-excerpt.js");
      const documentText = await readPinnedWordExcerpt({
        workspaceDir: config.workspaceDir,
        projectDir: projectDirResolved,
        pins: opts.contextPins,
      }).catch(() => "");
      if (isWordRevisionTurn({ instruction, pins: opts.contextPins })) {
        queue("craft", WORD_REVISION_PROMPT);
        if (
          wordRevisionShouldInjectFamilyChecklist(
            instruction,
            (opts.contextPins ?? [])
              .map((pin) =>
                "relPath" in pin && typeof pin.relPath === "string" ? pin.relPath : "",
              )
              .filter((p) => p.length > 0),
          )
        ) {
          queue(
            "protocol",
            formatWordRevisionChecklistBlock({
              instruction,
              pins: opts.contextPins,
              workspaceDir: config.workspaceDir,
              documentText,
              purpose: "revise",
            }),
          );
        }
      } else {
        const { isContractFastLaneInstruction, formatContractFastLanePrompt } =
          await import("../platform/contract-fast-lane-instruction.js");
        if (isContractFastLaneInstruction(instruction)) {
          const { deliveryPinsIncludeWord } = await import("../intent/delivery-intent.js");
          queue(
            "craft",
            formatContractFastLanePrompt({
              wordPinned: deliveryPinsIncludeWord(opts.contextPins),
            }),
          );
          queue(
            "protocol",
            formatWordRevisionChecklistBlock({
              instruction,
              pins: opts.contextPins,
              workspaceDir: config.workspaceDir,
              documentText,
              purpose: "review",
            }),
          );
        }
      }
    }
  } catch {
    /* optional */
  }

  try {
    const {
      bindLawyerCapability,
      formatBoundCapabilityBlock,
      hydrateCompiledIntent,
      readSkillPromptBodies,
    } = await import("../skills/lawyer-capabilities.js");
    const { isMailContractFastPathInstruction } =
      await import("../platform/mail-contract-short-path-instruction.js");
    const { isWordRevisionTurn } = await import("../platform/word-revision-instruction.js");
    const { compileIntent } = await import("../intent/compile-intent.js");
    const { formatCapabilityCatalogIndex, looksLikeLegalWork } =
      await import("../intent/catalog.js");
    const {
      compiledIntentInjectsSkillBodies,
      formatIntentHypothesisBlock,
      formatUnderstandFirstPromptBlock,
    } = await import("../intent/understand-first.js");
    const { extractWorkingBriefHints, formatWorkingBriefPromptBlock } =
      await import("../intent/working-brief.js");
    const mailFast = isMailContractFastPathInstruction(instruction);
    const compiled =
      opts.compiledIntent ??
      compileIntent({
        instruction,
        mailFastPath: mailFast,
        pins: opts.contextPins,
      });
    const bound =
      hydrateCompiledIntent(compiled) ??
      bindLawyerCapability({
        instruction,
        mailFastPath: mailFast,
        pins: opts.contextPins,
      });
    const hardBind = compiledIntentInjectsSkillBodies(compiled);
    const showCatalog = looksLikeLegalWork(instruction, hasContextPins) || Boolean(bound);
    if (showCatalog) {
      queue("protocol", formatUnderstandFirstPromptBlock());
      if (!session.turnPlan?.brief) {
        queue(
          "protocol",
          formatWorkingBriefPromptBlock(
            extractWorkingBriefHints({ instruction, pins: opts.contextPins }),
          ),
        );
      }
    }
    if (bound && hardBind) {
      const { planLeanSkillPrompt } = await import("../skills/skill-prompt-budget.js");
      const lean = planLeanSkillPrompt(bound, instruction);
      const bodies = readSkillPromptBodies(config.workspaceDir, lean.primaryIds);
      queue(
        "skill_index",
        formatBoundCapabilityBlock(bound, bodies, {
          indexLines: lean.indexLines,
          instruction,
          compiled,
        }),
        { overflow: { tool: "read_skill", path: "skills" } },
      );
      const {
        formatPracticePlaybookPromptBlock,
        loadPracticePlaybook,
        shouldInjectPracticePlaybook,
      } = await import("../practice/practice-playbook.js");
      if (shouldInjectPracticePlaybook(bound)) {
        queue(
          "protocol",
          formatPracticePlaybookPromptBlock(loadPracticePlaybook(config.workspaceDir)),
          { overflow: { tool: "read_workspace_file", path: "playbooks" } },
        );
      }
      const { formatUserStandardsPromptBlock, matchUserStandards, shouldInjectUserStandards } =
        await import("../practice/user-standards.js");
      if (shouldInjectUserStandards(bound)) {
        const { inferClosedContractType } = await import("../contracts/closed-contract-type.js");
        const stdKind =
          bound.id === "litigation.talk" || bound.id === "litigation.draft"
            ? "litigation_intake"
            : bound.id === "contract.review" || bound.id === "contract.draft"
              ? "contract_review"
              : undefined;
        const stdBlock = formatUserStandardsPromptBlock(
          matchUserStandards(
            config.workspaceDir,
            {
              instruction,
              contractType: inferClosedContractType(instruction).id,
            },
            stdKind,
          ),
        );
        queue("preference_fingerprint", stdBlock, {
          overflow: { tool: "read_workspace_file", path: "playbooks" },
        });
      }
      const {
        formatClosedContractTypePromptBlock,
        inferClosedContractType,
        shouldInjectClosedContractType,
      } = await import("../contracts/closed-contract-type.js");
      if (shouldInjectClosedContractType(bound)) {
        queue(
          "protocol",
          formatClosedContractTypePromptBlock(inferClosedContractType(instruction)),
        );
      }
      const protocolGate = {
        instruction,
        availableToolNames: opts.availableToolNames,
        pins: opts.contextPins,
      };
      const { formatAudienceSplitPromptBlock, inferDraftAudience, shouldInjectAudienceSplit } =
        await import("../drafts/audience-split.js");
      if (shouldInjectAudienceSplit(bound)) {
        queue("protocol", formatAudienceSplitPromptBlock(inferDraftAudience(instruction)));
      }
      const { shouldInjectRedlinePlanProtocol, formatRedlinePlanPromptBlock } =
        await import("../drafts/redline-plan.js");
      if (shouldInjectRedlinePlanProtocol(bound, protocolGate)) {
        queue("protocol", formatRedlinePlanPromptBlock());
      }
      const { shouldInjectResearchProtocol, formatResearchProtocolPromptBlock } =
        await import("../research/research-protocol.js");
      if (shouldInjectResearchProtocol(bound, protocolGate)) {
        queue("protocol", formatResearchProtocolPromptBlock());
      }
      const {
        shouldInjectBilateralReview,
        inferPaperSide,
        inferDealRole,
        formatBilateralReviewPromptBlock,
      } = await import("../practice/bilateral-review.js");
      if (shouldInjectBilateralReview(bound)) {
        queue(
          "protocol",
          formatBilateralReviewPromptBlock({
            paper: inferPaperSide(instruction),
            role: inferDealRole(instruction, inferClosedContractType(instruction).id),
            playbook: loadPracticePlaybook(config.workspaceDir),
          }),
        );
      }
    } else if (showCatalog) {
      const hypothesis = formatIntentHypothesisBlock(compiled);
      if (hypothesis) {
        queue("protocol", hypothesis);
      }
      queue("skill_index", formatCapabilityCatalogIndex(), {
        overflow: { tool: "read_skill", path: "skills" },
      });
    }
    const { formatIssueLedgerBlock, instructionNeedsIssueLedger } =
      await import("./issue-ledger.js");
    if (instructionNeedsIssueLedger(instruction)) {
      queue("protocol", formatIssueLedgerBlock());
    }
    const { isLookOnlyUtterance } = await import("../intent/utterance-kind.js");
    if (bound?.id === "litigation.draft" && !isLookOnlyUtterance(instruction)) {
      const { complaintMasterHint } = await import("../litigation/complaint-master.js");
      queue("protocol", complaintMasterHint(config.workspaceDir));
    }
    const { formatChatQaDeliveryPromptBlock, formatDeliveryConstraintPromptBlock } =
      await import("../intent/delivery-intent.js");
    const deliveryBlock = formatDeliveryConstraintPromptBlock(compiled.delivery);
    if (deliveryBlock) {
      queue("protocol", deliveryBlock);
    }
    const chatQaBlock = formatChatQaDeliveryPromptBlock(instruction);
    if (chatQaBlock && compiled.delivery.artifactShape === "unspecified") {
      queue("protocol", chatQaBlock);
    }
    const dt = deliverableTypeFromInstruction(instruction);
    const { isOpinionMemoDelivery } = await import("../intent/delivery-intent.js");
    const looksOpinion =
      !isWordRevisionTurn({ instruction, pins: opts.contextPins }) &&
      (isOpinionMemoDelivery(compiled.delivery) ||
        /意见书短路径|Opinion Craft|审查意见书/.test(instruction) ||
        ((dt === "contract.review" || /contract\.review/.test(instruction)) &&
          /prepare_outbound_mail|意见书/.test(instruction) &&
          !/【交办】5 分钟合同审查/.test(instruction)));
    if (looksOpinion) {
      const { OPINION_CRAFT_SKILL } = await import("../drafts/opinion-craft.js");
      if (!fragments.some((f) => f.body.includes("合同审查意见书"))) {
        queue("craft", OPINION_CRAFT_SKILL);
      }
    }
  } catch {
    /* optional */
  }

  if (session.needsCompactReinjection) {
    const { formatCompactReinjectionBlock } = await import("./compact-reinjection.js");
    const { mergeLegacyUpdateDraftWarningIntoCraft } =
      await import("../drafts/legacy-update-draft-warning.js");
    let craftBody = formatCompactReinjectionBlock({ mandatoryRulesActive: mandatoryRules.active });
    if (session.legacyUpdateDraftBodyWarning) {
      craftBody = mergeLegacyUpdateDraftWarningIntoCraft(craftBody);
    }
    queue("craft", craftBody, { worldStateId: "craft" });
    session.needsCompactReinjection = false;
  } else if (session.legacyUpdateDraftBodyWarning) {
    const { LEGACY_UPDATE_DRAFT_BODY_WARNING } =
      await import("../drafts/legacy-update-draft-warning.js");
    queue("craft", LEGACY_UPDATE_DRAFT_BODY_WARNING, { worldStateId: "craft" });
  }

  // 相似旧案不再自动进提示词。对照走 search_precedents，或 formatExplicitPrecedentRecall。

  // ── 素材块（D10）：三个通道合并进**一个**受预算约束的片段 ──────────────
  //
  // 为什么合并：三个通道此前各自 `queue("memory_hit", ...)`、各自 cap、各自优先级。
  // 实测撞了两次「打包器在块中间截断」——被腰斩的素材比没有更糟，因为看起来像
  // 一句完整的话。合并后由 `composeMaterialsBlock` 统一裁决，**整块取舍**，
  // 被丢掉的通道具名说明。
  //
  // 顺序即优先级（见 `material-blocks.ts` 的文件头）：
  //   派生事实（代码算的，最可靠） > 改稿范例（本所独有） > 黄金范例（结构性参考，可自行 read）
  //
  // 三处都在 try 里：素材是增强，任何一环失败都不该影响本轮 prompt。
  try {
    const dt = deliverableTypeFromInstruction(instruction);

    const facts = loadDerivedFactsForMatter({
      workspaceDir: config.workspaceDir,
      ...(session.matterId ? { matterId: session.matterId } : {}),
      ...(dt ? { deliverableType: dt } : {}),
    });

    const editHints = loadEditExamplesForDrafting({
      workspaceDir: config.workspaceDir,
      instruction,
      deliverableType: dt,
      limit: 2,
    });

    const goldenHints = loadGoldenExamplesForDrafting({
      workspaceDir: config.workspaceDir,
      instruction,
      deliverableType: dt,
      limit: 2,
    });

    const materials = composeMaterialsBlock([
      { id: "derived_facts", body: formatDerivedFactsPromptBlock(facts) },
      { id: "edit_examples", body: formatEditExamplesPromptBlock(editHints) },
      { id: "golden_examples", body: formatGoldenExamplesPromptBlock(goldenHints) },
    ]);
    queue(MATERIALS_FRAGMENT_KIND, materials.body, {
      capTokens: MATERIALS_BLOCK_CAP_TOKENS,
      priority: MATERIALS_FRAGMENT_PRIORITY,
    });
    // 观测：哪些通道被纳入、哪些因预算被整条丢弃。
    // 丢弃此前只写在 prompt 文案里（律师看得见、系统看不见），
    // 于是无法回答「某个通道是不是长期被丢」——那需要数字。
    recordMaterialBlockEvent(
      config.workspaceDir,
      materials,
      session.matterId ? { matterId: session.matterId } : undefined,
    );
  } catch {
    /* optional */
  }

  const packed = packPromptFragments(
    fragments,
    Math.max(
      FRAGMENT_SESSION_TAIL_BUDGET_TOKENS,
      Math.floor(FRAGMENT_SESSION_TAIL_BUDGET_TOKENS * envelope.promptWindowScale),
    ),
  );
  const { worldState, sessionTail } = partitionPackedFragments(packed);
  const worldBlocks = renderPackedFragments(worldState);
  if (worldBlocks.length > 0) {
    systemPromptFinal = systemPrompt + worldBlocks.join("");
  }
  const tail = renderPackedFragments(sessionTail).join("").trim();
  session.samplingPromptTail = tail || undefined;
  const { isWordRevisionTurn } = await import("../platform/word-revision-instruction.js");
  const {
    extractSkeletonHeadings,
    instructionRequestsFreeDraft,
    rememberBuiltinTemplateSkeleton,
    rememberSkeleton,
    selectSkeleton,
  } = await import("./factor-state.js");
  const { explicitTemplateId } = await import("./ooxml-skeleton.js");
  if (!session.factorState) {
    const { emptyFactorState } = await import("./factor-state.js");
    session.factorState = emptyFactorState();
  }
  rememberSkeleton(session.factorState, extractSkeletonHeadings(instruction));
  const templateId = explicitTemplateId(instruction);
  if (templateId) {
    rememberBuiltinTemplateSkeleton(session.factorState, templateId);
  }
  const skeleton = selectSkeleton({
    revisingDocument:
      isWordRevisionTurn(instruction) || /contract_edit_baseline_path\s*=/.test(instruction),
  });
  if (skeleton.header && instructionRequestsFreeDraft(instruction)) {
    session.samplingPromptTail = session.samplingPromptTail
      ? `${session.samplingPromptTail}\n${skeleton.header}`
      : skeleton.header;
  }

  const existingSystem =
    session.conversationHistory[0]?.role === "system"
      ? session.conversationHistory[0].content
      : undefined;
  systemPromptFinal = applySystemPromptToHistory(existingSystem, systemPromptFinal);
  const nextHashes = collectWorldStateHashes(systemPromptFinal);
  systemPromptFinal = stabilizeUnchangedWorldState(
    systemPromptFinal,
    existingSystem,
    session.worldStateBaseline,
    nextHashes,
  );
  const committedHashes = collectWorldStateHashes(systemPromptFinal);
  const prevBaseline = session.worldStateBaseline;
  const worldStateChanged = WORLD_STATE_SECTION_IDS.some(
    (id) => prevBaseline?.[id] !== committedHashes[id],
  );
  session.worldStateBaseline = committedHashes;
  if (worldStateChanged) {
    session.worldStateEpoch = (session.worldStateEpoch ?? 0) + 1;
  }

  // Write history first; runModelToolLoop may only derive via deriveModelMessages.
  if (
    session.conversationHistory.length === 0 ||
    session.conversationHistory[0].role !== "system"
  ) {
    session.conversationHistory.unshift({
      role: "system",
      content: systemPromptFinal,
      timestamp: new Date().toISOString(),
    });
  } else if (session.conversationHistory[0].content !== systemPromptFinal) {
    session.conversationHistory[0].content = systemPromptFinal;
    session.conversationHistory[0].timestamp = new Date().toISOString();
  }

  return {
    memory,
    systemPromptFinal,
    presetForTools,
    roleForTools,
    lawMindRoot,
  };
}
