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
import { resolveMailAccountForMatter } from "../mail/mail-accounts.js";
import { buildMailSendFormatPrompt } from "../mail/mail-send-format.js";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import {
  formatExecutablePreferencesHint,
  loadExecutablePreferences,
} from "../memory/executable-preferences.js";
import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import { lawyerProfileForPrompt } from "../memory/lawyer-profile-for-prompt.js";
import { findRelevantMemoriesForTurn } from "../memory/relevant-recall.js";
import {
  findSimilarCaseMemories,
  formatSimilarCaseRecallBlock,
} from "../memory/similar-case-recall.js";
import { resolveCapabilityEnvelope } from "../models/capability-envelope.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentPromptVerbosity,
  resolveAppliedPreferencesFooterMode,
  resolveMatterMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import { buildAuthorityCorpusSummary } from "../retrieval/authority-health.js";
import { isAuthorityLive } from "../retrieval/authority-source-tier.js";
import {
  deliverableTypeFromInstruction,
  instructionLooksLikeFilledIntake,
  resolveIntakeClarificationQuestions,
} from "../router/intake-gate.js";
import { buildContextPlan, buildContextPlanMarkdown } from "../runtime/context-plan.js";
import { resolvePinnedContextSummary, withContractPlaybookPin } from "../runtime/pinned-context.js";
import { formatStanceHint } from "../stance/inject.js";
import { getAssistantPreset } from "./assistant-presets.js";
import { buildDeliverablePipelineSystemNote } from "./deliverable-pipeline.js";
import type { AgentPermissionMode } from "./permission-mode.js";
import {
  createPromptFragment,
  packPromptFragments,
  partitionPackedFragments,
  renderPackedFragments,
  capFragmentBody,
  FRAGMENT_CAPS,
  FRAGMENT_SESSION_TAIL_BUDGET_TOKENS,
  type PromptFragment,
  type PromptFragmentKind,
  type PromptOverflow,
} from "./prompt-fragments.js";
import { applySystemPromptToHistory, buildSystemPrompt } from "./system-prompt.js";
import { promptCatalogToolNames } from "./tools/governance.js";
import type { ToolRegistry } from "./tools/registry.js";
import { collectRecentToolNamesFromSession } from "./turn-orchestrator-events.js";
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
  },
): void {
  const fragment = createPromptFragment({
    kind,
    body: body ?? "",
    overflow: opts?.overflow ?? null,
    worldStateId: opts?.worldStateId,
    capTokens: opts?.capTokens,
    priority: opts?.priority,
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
  teamMeetingMode?: boolean;
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
    teamMeetingMode,
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
  const intakeHardQs = resolveIntakeClarificationQuestions(instruction, {
    caseMemory: memory.caseMemory,
    intakeHeuristicsEnabled: workspacePolicy?.intakeHeuristicsEnabled,
    hasContextPins,
  });
  const intakeAdvisoryQs = resolveIntakeAdvisoryQuestions(instruction, {
    caseMemory: memory.caseMemory,
    intakeHeuristicsEnabled: workspacePolicy?.intakeHeuristicsEnabled,
    hasContextPins,
  });
  const deliverablePipelineNote =
    intakeHardQs.length === 0 || instructionLooksLikeFilledIntake(instruction)
      ? buildDeliverablePipelineSystemNote(instruction)
      : undefined;
  const lawyerProfileForSystem = lawyerProfileForPrompt(memory.profile ?? "");
  const executablePrefs = loadExecutablePreferences(
    config.workspaceDir,
    lawyerProfileForSystem ?? "",
    6,
  );
  let appliedPreferencesHint = formatExecutablePreferencesHint(executablePrefs);
  const stanceHint = formatStanceHint(config.workspaceDir, { matterId: session.matterId });
  if (stanceHint) {
    appliedPreferencesHint = appliedPreferencesHint
      ? `${appliedPreferencesHint}\n\n${stanceHint}`
      : stanceHint;
  }
  if (appliedPreferencesHint) {
    appliedPreferencesHint = capFragmentBody(
      appliedPreferencesHint,
      FRAGMENT_CAPS.preference_fingerprint.capTokens,
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
  const envelope = resolveCapabilityEnvelope({
    contextTokens: config.model.contextTokens ?? workspacePolicy?.context?.contextTokens,
    timeoutMs: config.model.timeoutMs,
  });
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
  const windowedCase = windowCaseMarkdownForPrompt(
    memory.caseMemory,
    promptWindow.matterContextChars,
    matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
  );
  const lawyerFingerprint = truncateForPrompt(
    lawyerProfileForSystem ?? "",
    promptWindow.lawyerFingerprintChars,
    { overflow: { tool: "read_workspace_file", path: "LAWYER_PROFILE.md" } },
  );
  const assistantFingerprint = assistantProfileMarkdown
    ? truncateForPrompt(assistantProfileMarkdown, promptWindow.assistantFingerprintChars, {
        overflow: { tool: "read_workspace_file", path: "assistants" },
      })
    : "";
  const clientFingerprint = truncateForPrompt(
    memory.clientProfile,
    promptWindow.clientFingerprintChars,
    { overflow: { tool: "read_workspace_file", path: clientRel } },
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
    matterId: session.matterId,
    roleTitle: config.roleTitle,
    roleIntroduction: config.roleIntroduction,
    roleDirective: config.roleDirective,
    roleRiskCeiling: presetForTools?.riskCeiling,
    roleAcceptanceChecklist: presetForTools?.acceptanceChecklist,
    allowWebSearch: config.allowWebSearch === true,
    authorityLive: isAuthorityLive(),
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
    teamMeetingMode: teamMeetingMode === true,
    runtimeModel: config.runtimeModel,
    appliedPreferencesHint,
    mailSendFormatHint,
  });

  let systemPromptFinal = systemPrompt;
  const fragments: PromptFragment[] = [];
  if (lawyerFingerprint) {
    queueFragment(fragments, "preference_fingerprint", `## 当前律师\n\n${lawyerFingerprint}`, {
      overflow: { tool: "read_workspace_file", path: "LAWYER_PROFILE.md" },
      capTokens: promptWindow.lawyerFingerprintChars,
    });
  }
  if (assistantFingerprint) {
    queueFragment(
      fragments,
      "preference_fingerprint",
      `## 本助手专属偏好（assistants/<id>/PROFILE.md）\n\n${assistantFingerprint}`,
      {
        overflow: { tool: "read_workspace_file", path: "assistants" },
        capTokens: promptWindow.assistantFingerprintChars,
      },
    );
  }
  if (clientFingerprint) {
    queueFragment(
      fragments,
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
    queueFragment(
      fragments,
      "matter_index",
      `## 当前案件 [${session.matterId}]\n\n${matterIndex}`,
      {
        overflow: matterRel ? { tool: "read_case_file", path: matterRel } : undefined,
        capTokens: promptWindow.matterIndexChars,
      },
    );
  }
  if (dayLogIndex) {
    queueFragment(fragments, "memory_hit", `## 今日工作记录\n\n${dayLogIndex}`, {
      overflow: { tool: "read_workspace_file", path: todayMemoryLogRel() },
      capTokens: promptWindow.dayLogIndexChars,
    });
  }
  if (contextPlanMarkdown.trim()) {
    queueFragment(fragments, "protocol", `## 上下文计划（ContextPlan）\n\n${contextPlanMarkdown}`);
  }
  queueFragment(fragments, "pins", pinnedContextSummary.markdownBlock, { worldStateId: "pins" });
  try {
    const { pinsIncludeXlsx } = await import("./tools/disclosed-turn-tools.js");
    if (pinsIncludeXlsx(opts.contextPins)) {
      queueFragment(
        fragments,
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
    queueFragment(fragments, "pins", located);
  } catch {
    /* optional */
  }
  queueFragment(fragments, "matter_index", formatMatterWorldState(session.matterId), {
    worldStateId: "matter",
  });
  queueFragment(
    fragments,
    "environment",
    formatPermissionWorldState(opts.permissionMode ?? "standard", {
      allowWebSearch: config.allowWebSearch === true,
    }),
    { worldStateId: "permission" },
  );
  if (opts.permissionMode === "readonly" || opts.permissionMode === "research") {
    queueFragment(
      fragments,
      "protocol",
      opts.permissionMode === "research"
        ? "## 计划模式（仅调研）\n本回合只能检索、读材料、`update_plan`、`read_skill`。不要起草、改稿或导出。律师点「开始执行」后再写稿。"
        : "## 计划模式\n本回合写工具关闭。先用 `update_plan` 列出 2–8 步可执行计划；需要质量规格时调用 `read_skill`。不要声称已出稿或任务已完成。律师点「开始执行」后才会开放起草。",
    );
  }
  if (session.turnPlan) {
    queueFragment(fragments, "turn_plan", formatTurnPlanWorldState(session.turnPlan), {
      worldStateId: "plan",
    });
  }
  queueFragment(fragments, "deliverable", deliverablePipelineNote, { worldStateId: "deliverable" });

  if (session.pendingClarificationKeys?.length) {
    const { selectHardClarificationKeys } = await import("../router/intake-gate.js");
    const hardKeys = selectHardClarificationKeys(session.pendingClarificationKeys);
    if (hardKeys.length > 0) {
      queueFragment(
        fragments,
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
    const pending = await listPendingMemorySuggestions(config.workspaceDir);
    const previewItems = pending
      .filter((r) => {
        if (r.scope === "lawyer") {
          return true;
        }
        if (r.scope === "matter" && session.matterId?.trim()) {
          return r.targetId === session.matterId.trim();
        }
        return false;
      })
      .slice(0, 6);
    if (previewItems.length > 0) {
      const lines = previewItems.map(
        (r, i) =>
          `${i + 1}. [${r.scope}/${r.kind}] ${String(r.payload ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 220)}`,
      );
      queueFragment(
        fragments,
        "memory_hit",
        [
          "## 待律师采纳的偏好/案件要点（预览，只读）",
          "",
          "以下来自整理上下文/沉淀学习等，**尚未写入** MEMORY / CASE；不得当作已生效指令执行。律师可在记忆检查中采纳或驳回。",
          "",
          ...lines,
        ].join("\n"),
      );
    }
  } catch {
    /* optional */
  }

  const surfaced = new Set(session.alreadySurfacedMemoryPaths ?? []);
  if (session.matterId?.trim()) {
    surfaced.add(`cases/${session.matterId.trim()}/CASE.md`);
  }
  const recentToolNames = collectRecentToolNamesFromSession(session);
  const recalled = await findRelevantMemoriesForTurn({
    workspaceDir: config.workspaceDir,
    matterId: session.matterId,
    query: instruction,
    alreadySurfaced: surfaced,
    recentToolNames,
    policy: workspacePolicy,
  });
  if (recalled.length > 0) {
    const lines = ["## 相关记忆（本轮召回）", ""];
    for (const hit of recalled) {
      lines.push(`### ${hit.relativePath}`);
      if (hit.gist) {
        lines.push(hit.gist);
      }
      lines.push(`完整内容请用 read_workspace_file 读取 ${hit.relativePath}`);
      surfaced.add(hit.relativePath);
    }
    session.alreadySurfacedMemoryPaths = [...surfaced];
    queueFragment(fragments, "memory_hit", lines.join("\n"), {
      overflow: {
        tool: "read_workspace_file",
        path: recalled[0]?.relativePath ?? "MEMORY.md",
      },
    });
  }

  try {
    const revisionBlock = await buildContractRevisionRecallBlock({
      workspaceDir: config.workspaceDir,
      instruction,
      matterId: session.matterId,
      limit: 3,
    });
    queueFragment(fragments, "memory_hit", revisionBlock);
  } catch {
    /* optional recall */
  }

  try {
    const { INTAKE_CRAFT_SKILL, formatIntakeSoftAskBlock } =
      await import("../router/intake-craft.js");
    if (intakeAdvisoryQs.length > 0) {
      queueFragment(fragments, "craft", INTAKE_CRAFT_SKILL);
      queueFragment(fragments, "protocol", formatIntakeSoftAskBlock(intakeAdvisoryQs));
    }
  } catch {
    /* optional */
  }

  try {
    const { isMailContractFastPathInstruction, MAIL_CONTRACT_FAST_PATH_PROMPT } =
      await import("./mail-contract-fast-path.js");
    if (isMailContractFastPathInstruction(instruction)) {
      queueFragment(fragments, "craft", MAIL_CONTRACT_FAST_PATH_PROMPT);
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
        queueFragment(fragments, "craft", WORD_REVISION_PROMPT);
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
          queueFragment(
            fragments,
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
          queueFragment(
            fragments,
            "craft",
            formatContractFastLanePrompt({
              wordPinned: deliveryPinsIncludeWord(opts.contextPins),
            }),
          );
          queueFragment(
            fragments,
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
    if (bound) {
      const { planLeanSkillPrompt } = await import("../skills/skill-prompt-budget.js");
      const lean = planLeanSkillPrompt(bound, instruction);
      const bodies = readSkillPromptBodies(config.workspaceDir, lean.primaryIds);
      queueFragment(
        fragments,
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
        queueFragment(
          fragments,
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
        queueFragment(fragments, "preference_fingerprint", stdBlock, {
          overflow: { tool: "read_workspace_file", path: "playbooks" },
        });
      }
      const {
        formatClosedContractTypePromptBlock,
        inferClosedContractType,
        shouldInjectClosedContractType,
      } = await import("../contracts/closed-contract-type.js");
      if (shouldInjectClosedContractType(bound)) {
        queueFragment(
          fragments,
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
        queueFragment(
          fragments,
          "protocol",
          formatAudienceSplitPromptBlock(inferDraftAudience(instruction)),
        );
      }
      const { shouldInjectRedlinePlanProtocol, formatRedlinePlanPromptBlock } =
        await import("../drafts/redline-plan.js");
      if (shouldInjectRedlinePlanProtocol(bound, protocolGate)) {
        queueFragment(fragments, "protocol", formatRedlinePlanPromptBlock());
      }
      const { shouldInjectPairedReviewDeliverable, formatPairedReviewDeliverablePromptBlock } =
        await import("../drafts/paired-review-deliverable.js");
      if (shouldInjectPairedReviewDeliverable(bound, opts.contextPins, protocolGate)) {
        queueFragment(fragments, "protocol", formatPairedReviewDeliverablePromptBlock());
      }
      const { shouldInjectResearchProtocol, formatResearchProtocolPromptBlock } =
        await import("../research/research-protocol.js");
      if (shouldInjectResearchProtocol(bound, protocolGate)) {
        queueFragment(fragments, "protocol", formatResearchProtocolPromptBlock());
      }
      if (bound.id === "litigation.draft") {
        const { complaintMasterHint } = await import("../litigation/complaint-master.js");
        queueFragment(fragments, "protocol", complaintMasterHint(config.workspaceDir));
      }
      const {
        shouldInjectBilateralReview,
        inferPaperSide,
        inferDealRole,
        formatBilateralReviewPromptBlock,
      } = await import("../practice/bilateral-review.js");
      if (shouldInjectBilateralReview(bound)) {
        queueFragment(
          fragments,
          "protocol",
          formatBilateralReviewPromptBlock({
            paper: inferPaperSide(instruction),
            role: inferDealRole(instruction, inferClosedContractType(instruction).id),
            playbook: loadPracticePlaybook(config.workspaceDir),
          }),
        );
      }
    } else if (looksLikeLegalWork(instruction, hasContextPins)) {
      queueFragment(fragments, "skill_index", formatCapabilityCatalogIndex(), {
        overflow: { tool: "read_workspace_file", path: "skills" },
      });
    }
    const { formatDeliveryConstraintPromptBlock } = await import("../intent/delivery-intent.js");
    const deliveryBlock = formatDeliveryConstraintPromptBlock(compiled.delivery);
    if (deliveryBlock) {
      queueFragment(fragments, "protocol", deliveryBlock);
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
        queueFragment(fragments, "craft", OPINION_CRAFT_SKILL);
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
    queueFragment(fragments, "craft", craftBody, { worldStateId: "craft" });
    session.needsCompactReinjection = false;
  } else if (session.legacyUpdateDraftBodyWarning) {
    const { LEGACY_UPDATE_DRAFT_BODY_WARNING } =
      await import("../drafts/legacy-update-draft-warning.js");
    queueFragment(fragments, "craft", LEGACY_UPDATE_DRAFT_BODY_WARNING, { worldStateId: "craft" });
  }

  try {
    const similar = await findSimilarCaseMemories({
      workspaceDir: config.workspaceDir,
      instruction,
      currentMatterId: session.matterId,
      limit: 2,
    });
    queueFragment(fragments, "memory_hit", formatSimilarCaseRecallBlock(similar));
  } catch {
    /* optional */
  }

  try {
    const dt = deliverableTypeFromInstruction(instruction);
    const goldenHints = loadGoldenExamplesForDrafting({
      workspaceDir: config.workspaceDir,
      instruction,
      deliverableType: dt,
      limit: 2,
    });
    queueFragment(fragments, "memory_hit", formatGoldenExamplesPromptBlock(goldenHints));
  } catch {
    /* optional */
  }

  const packed = packPromptFragments(fragments, FRAGMENT_SESSION_TAIL_BUDGET_TOKENS);
  const { worldState, sessionTail } = partitionPackedFragments(packed);
  const worldBlocks = renderPackedFragments(worldState);
  if (worldBlocks.length > 0) {
    systemPromptFinal = systemPrompt + worldBlocks.join("");
  }
  const tail = renderPackedFragments(sessionTail).join("").trim();
  session.samplingPromptTail = tail || undefined;

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
