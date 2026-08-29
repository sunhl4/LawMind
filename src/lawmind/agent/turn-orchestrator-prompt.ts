/**
 * System prompt assembly for a single agent turn.
 * Extracted from turn-orchestrator.ts.
 */

import fs from "node:fs";
import path from "node:path";
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
import { applySystemPromptToHistory, buildSystemPrompt } from "./system-prompt.js";
import { promptCatalogToolNames } from "./tools/governance.js";
import type { ToolRegistry } from "./tools/registry.js";
import { collectRecentToolNamesFromSession } from "./turn-orchestrator-events.js";
import type { AgentConfig, AgentContext, AgentSession } from "./types.js";
import {
  collectWorldStateHashes,
  formatMatterWorldState,
  formatPermissionWorldState,
  stabilizeUnchangedWorldState,
  WORLD_STATE_SECTION_IDS,
  wrapWorldStateSection,
  type WorldStateSectionId,
} from "./world-state.js";

function pushWorldStateExtra(extraBlocks: string[], id: WorldStateSectionId, body: string): void {
  const wrapped = wrapWorldStateSection(id, body);
  if (wrapped) {
    extraBlocks.push(`\n\n${wrapped}`);
  }
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
    pins: withContractPlaybookPin(opts.contextPins, instruction),
  });

  const memory = await loadMemoryContext(config.workspaceDir, { matterId: session.matterId });

  let assistantProfileMarkdown = "";
  let presetForTools: ReturnType<typeof getAssistantPreset> | undefined;
  let roleForTools: ReturnType<typeof getRoleById> | undefined;
  if (resolvedAssistantId) {
    try {
      const lawMindRootForProfile = resolveLawMindRoot(config.workspaceDir);
      assistantProfileMarkdown = readAssistantProfileMarkdown(
        lawMindRootForProfile,
        resolvedAssistantId,
      );
      const prof = getAssistantById(lawMindRootForProfile, resolvedAssistantId);
      presetForTools = getAssistantPreset(prof?.presetKey);
      // W7：优先用 Role；过渡期回退到 preset。
      roleForTools = getRoleById(prof?.roleId ?? prof?.presetKey);
    } catch {
      assistantProfileMarkdown = "";
    }
  }

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
  const executablePrefs = loadExecutablePreferences(config.workspaceDir, memory.profile ?? "", 6);
  let appliedPreferencesHint = formatExecutablePreferencesHint(executablePrefs);
  const stanceHint = formatStanceHint(config.workspaceDir);
  if (stanceHint) {
    appliedPreferencesHint = appliedPreferencesHint
      ? `${appliedPreferencesHint}\n\n${stanceHint}`
      : stanceHint;
  }
  const footerMode = resolveAppliedPreferencesFooterMode(workspacePolicy);
  const requireAppliedPreferencesFooter =
    Boolean(appliedPreferencesHint) &&
    (footerMode === "always" || (footerMode === "first" && session.turns.length === 0));
  const agentPromptVerbosity = resolveAgentPromptVerbosity(workspacePolicy);
  const promptCatalog = new Set(promptCatalogToolNames());
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
  const systemPrompt = buildSystemPrompt({
    lawyerProfile: truncateForPrompt(memory.profile, promptWindow.lawyerProfileChars) || undefined,
    assistantProfileMarkdown: assistantProfileMarkdown
      ? truncateForPrompt(assistantProfileMarkdown, promptWindow.assistantProfileChars)
      : undefined,
    clientProfile:
      truncateForPrompt(memory.clientProfile, promptWindow.clientProfileChars) || undefined,
    matterContext:
      windowCaseMarkdownForPrompt(memory.caseMemory, promptWindow.matterContextChars) || undefined,
    todayLog: truncateForPrompt(memory.todayLog, promptWindow.dayLogChars) || undefined,
    availableTools: registry
      .listDefinitions()
      .filter((def) => promptCatalog.has(def.name))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    matterId: session.matterId,
    roleTitle: config.roleTitle,
    roleIntroduction: config.roleIntroduction,
    roleDirective: config.roleDirective,
    roleRiskCeiling: presetForTools?.riskCeiling,
    roleAcceptanceChecklist: presetForTools?.acceptanceChecklist,
    allowWebSearch: config.allowWebSearch === true,
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
    deliverablePipelineNote,
    appliedPreferencesHint,
    contextPlanMarkdown,
    mailSendFormatHint,
  });

  let systemPromptFinal = systemPrompt;
  const extraBlocks: string[] = [];
  if (pinnedContextSummary.markdownBlock) {
    pushWorldStateExtra(extraBlocks, "pins", pinnedContextSummary.markdownBlock);
  }
  try {
    const { pinsIncludeXlsx } = await import("./tools/disclosed-turn-tools.js");
    if (pinsIncludeXlsx(opts.contextPins)) {
      extraBlocks.push(
        [
          "",
          "## 表格分析",
          "已钉选电子表格。请先 `analyze_spreadsheet`，需要算术用 `calculate`（公式与输入必须带回）。",
          "出图用 `render_chart`，并在助手正文用 ```lm-chart 围栏原样贴回完整 spec。落表用 `write_spreadsheet`。",
          "数字必须写明来源列。不要把整表倒成 TSV。",
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
    if (located) {
      extraBlocks.push(`\n\n${located}`);
    }
  } catch {
    /* optional */
  }
  pushWorldStateExtra(extraBlocks, "matter", formatMatterWorldState(session.matterId));
  pushWorldStateExtra(
    extraBlocks,
    "permission",
    formatPermissionWorldState(opts.permissionMode ?? "standard"),
  );

  if (session.pendingClarificationKeys?.length) {
    pushWorldStateExtra(
      extraBlocks,
      "policy",
      [
        "## 未决澄清要点（跨轮保留）",
        "",
        "律师尚未完全回答下列关键缺口；继续时可先用只读/`research_task` 收集材料，但**不得**在缺口未对齐时调用 `draft_document` / `execute_workflow` / `render_document`。",
        "",
        `待确认键：${session.pendingClarificationKeys.join(", ")}`,
      ].join("\n"),
    );
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
      extraBlocks.push(
        [
          "\n\n## 待律师采纳的偏好/案件要点（预览，只读）",
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
  // 当前 CASE 已进 system prompt，避免相关记忆再整段注入同一文件
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
    const blocks: string[] = ["\n\n## 相关记忆（本轮召回）\n"];
    for (const hit of recalled) {
      try {
        const full = path.join(config.workspaceDir, hit.relativePath);
        const text = fs.readFileSync(full, "utf8").slice(0, 4_000);
        blocks.push(`### ${hit.relativePath}\n${text}`);
        surfaced.add(hit.relativePath);
      } catch {
        /* skip missing */
      }
    }
    session.alreadySurfacedMemoryPaths = [...surfaced];
    extraBlocks.push(blocks.join("\n"));
  }

  try {
    const revisionBlock = await buildContractRevisionRecallBlock({
      workspaceDir: config.workspaceDir,
      instruction,
      matterId: session.matterId,
      limit: 3,
    });
    if (revisionBlock) {
      extraBlocks.push(`\n\n${revisionBlock}`);
    }
  } catch {
    /* optional recall */
  }

  try {
    const { INTAKE_CRAFT_SKILL, formatIntakeSoftAskBlock } =
      await import("../router/intake-craft.js");
    if (intakeAdvisoryQs.length > 0) {
      extraBlocks.push(`\n\n${INTAKE_CRAFT_SKILL}`);
      extraBlocks.push(`\n\n${formatIntakeSoftAskBlock(intakeAdvisoryQs)}`);
    }
  } catch {
    /* optional */
  }

  try {
    const { isMailContractFastPathInstruction, MAIL_CONTRACT_FAST_PATH_PROMPT } =
      await import("./mail-contract-fast-path.js");
    if (isMailContractFastPathInstruction(instruction)) {
      extraBlocks.push(`\n\n${MAIL_CONTRACT_FAST_PATH_PROMPT}`);
    } else {
      const { isWordRevisionTurn, WORD_REVISION_PROMPT } =
        await import("../platform/word-revision-instruction.js");
      const { CONTRACT_REDLINE_CRAFT_SKILL } = await import("../drafts/contract-redline-craft.js");
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
        extraBlocks.push(
          `\n\n${WORD_REVISION_PROMPT}\n\n${formatWordRevisionChecklistBlock({
            instruction,
            pins: opts.contextPins,
            workspaceDir: config.workspaceDir,
            documentText,
            purpose: "revise",
          })}\n\n${CONTRACT_REDLINE_CRAFT_SKILL}`,
        );
      } else {
        const { isContractFastLaneInstruction, CONTRACT_FAST_LANE_PROMPT } =
          await import("../platform/contract-fast-lane-instruction.js");
        if (isContractFastLaneInstruction(instruction)) {
          extraBlocks.push(`\n\n${CONTRACT_FAST_LANE_PROMPT}`);
          extraBlocks.push(
            `\n\n${formatWordRevisionChecklistBlock({
              instruction,
              pins: opts.contextPins,
              workspaceDir: config.workspaceDir,
              documentText,
              purpose: "review",
            })}`,
          );
        }
      }
    }
  } catch {
    /* optional */
  }

  try {
    const { bindLawyerCapability, formatBoundCapabilityBlock, readSkillPromptBodies } =
      await import("../skills/lawyer-capabilities.js");
    const { isMailContractFastPathInstruction } =
      await import("../platform/mail-contract-short-path-instruction.js");
    const { isWordRevisionTurn } = await import("../platform/word-revision-instruction.js");
    const mailFast = isMailContractFastPathInstruction(instruction);
    const bound = bindLawyerCapability({
      instruction,
      mailFastPath: mailFast,
      pins: opts.contextPins,
    });
    if (bound) {
      const bodies = readSkillPromptBodies(config.workspaceDir, bound.skillIds);
      extraBlocks.push(`\n\n${formatBoundCapabilityBlock(bound, bodies)}`);
    }
    const dt = deliverableTypeFromInstruction(instruction);
    const looksOpinion =
      !isWordRevisionTurn({ instruction, pins: opts.contextPins }) &&
      (/意见书短路径|Opinion Craft|审查意见书|合同审查意见/.test(instruction) ||
        ((dt === "contract.review" || /contract\.review/.test(instruction)) &&
          /prepare_outbound_mail|意见书/.test(instruction)));
    if (looksOpinion) {
      const { OPINION_CRAFT_SKILL } = await import("../drafts/opinion-craft.js");
      if (!extraBlocks.some((b) => b.includes("合同审查意见书"))) {
        extraBlocks.push(`\n\n${OPINION_CRAFT_SKILL}`);
      }
    }
  } catch {
    /* optional */
  }

  if (session.needsCompactReinjection) {
    const { formatCompactReinjectionBlock } = await import("./compact-reinjection.js");
    pushWorldStateExtra(
      extraBlocks,
      "craft",
      formatCompactReinjectionBlock({ mandatoryRulesActive: mandatoryRules.active }),
    );
    session.needsCompactReinjection = false;
  }

  try {
    const similar = await findSimilarCaseMemories({
      workspaceDir: config.workspaceDir,
      instruction,
      currentMatterId: session.matterId,
      limit: 2,
    });
    const similarBlock = formatSimilarCaseRecallBlock(similar);
    if (similarBlock) {
      extraBlocks.push(`\n\n${similarBlock}`);
    }
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
    const goldenBlock = formatGoldenExamplesPromptBlock(goldenHints);
    if (goldenBlock) {
      extraBlocks.push(`\n\n${goldenBlock}`);
    }
  } catch {
    /* optional */
  }

  if (extraBlocks.length > 0) {
    systemPromptFinal = systemPrompt + extraBlocks.join("");
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
  } else {
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
