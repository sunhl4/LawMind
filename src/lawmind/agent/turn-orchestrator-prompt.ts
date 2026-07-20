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
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import { deliverableTypeFromInstruction } from "../router/intake-gate.js";
import { getAssistantPreset } from "./assistant-presets.js";
import { buildDeliverablePipelineSystemNote } from "./deliverable-pipeline.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ToolRegistry } from "./tools/registry.js";
import { collectRecentToolNamesFromSession } from "./turn-orchestrator-events.js";
import type { AgentConfig, AgentSession } from "./types.js";

export async function prepareTurnPromptContext(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  session: AgentSession;
  instruction: string;
  resolvedAssistantId: string | undefined;
  linkedTaskIdForCtx: string | undefined;
  projectDirResolved: string | undefined;
  teamMeetingMode?: boolean;
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

  const deliverablePipelineNote = buildDeliverablePipelineSystemNote(instruction);
  const executablePrefs = loadExecutablePreferences(config.workspaceDir, memory.profile ?? "", 6);
  const appliedPreferencesHint = formatExecutablePreferencesHint(executablePrefs);
  const { PROMPT_WINDOW, truncateForPrompt, windowCaseMarkdownForPrompt } =
    await import("../memory/prompt-windows.js");
  const systemPrompt = buildSystemPrompt({
    lawyerProfile: truncateForPrompt(memory.profile, PROMPT_WINDOW.lawyerProfileChars) || undefined,
    assistantProfileMarkdown: assistantProfileMarkdown
      ? truncateForPrompt(assistantProfileMarkdown, PROMPT_WINDOW.assistantProfileChars)
      : undefined,
    clientProfile:
      truncateForPrompt(memory.clientProfile, PROMPT_WINDOW.clientProfileChars) || undefined,
    matterContext: windowCaseMarkdownForPrompt(memory.caseMemory) || undefined,
    todayLog: truncateForPrompt(memory.todayLog, PROMPT_WINDOW.dayLogChars) || undefined,
    availableTools: registry.listDefinitions(),
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
    assistantOrgLine,
    teamOrgOverview,
    teamMeetingMode: teamMeetingMode === true,
    runtimeModel: config.runtimeModel,
    deliverablePipelineNote,
    appliedPreferencesHint,
  });

  let systemPromptFinal = systemPrompt;
  const extraBlocks: string[] = [];
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
        const text = fs.readFileSync(full, "utf8").slice(0, 2500);
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
