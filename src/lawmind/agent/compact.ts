import fs from "node:fs";
import path from "node:path";
import { readQueueItems } from "../adapters/matter-storage/index.js";
import { validateDraftAgainstSpec } from "../deliverables/index.js";
import { readDraft } from "../drafts/index.js";
import { caseFilePath } from "../memory/index.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { estimateTokenBudget, resolveContextPolicy } from "./context-budget.js";
import { compactHistory } from "./session.js";
import type { AgentMessage, AgentSession } from "./types.js";

export type CompactResult = {
  messages: AgentMessage[];
  compacted: boolean;
  sessionSummaryPath?: string;
  droppedMessageCount?: number;
};

export function sessionSummaryPath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "session-summary.md");
}

export function readSessionSummary(workspaceDir: string, matterId?: string): string {
  if (!matterId?.trim()) {
    return "";
  }
  const fp = sessionSummaryPath(workspaceDir, matterId.trim());
  try {
    return fs.readFileSync(fp, "utf8").trim();
  } catch {
    return "";
  }
}

/** Prevent cutting between assistant tool_use and following tool messages. */
export function adjustIndexToPreserveToolPairs(messages: AgentMessage[]): number {
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (nonSystem.length <= 8) {
    return 0;
  }
  const keepFrom = Math.max(0, nonSystem.length - 24);
  let idx = messages.findIndex((m) => m === nonSystem[keepFrom]);
  if (idx <= 0) {
    return 0;
  }
  const prev = messages[idx - 1];
  if (prev?.role === "assistant" && (prev.toolCalls?.length ?? 0) > 0) {
    return Math.max(0, idx - 1);
  }
  return idx;
}

export function collectCompactAttachmentNotes(
  workspaceDir: string,
  opts: {
    matterId?: string;
    linkedTaskId?: string;
    pendingClarificationKeys?: string[];
  },
): string[] {
  const blocks: string[] = [];
  if (opts.linkedTaskId?.trim()) {
    const taskId = opts.linkedTaskId.trim();
    const draft = readDraft(workspaceDir, taskId);
    if (draft) {
      const acceptance = validateDraftAgainstSpec(draft);
      blocks.push(
        `【关联草稿 ${taskId}】\n- 类型: ${draft.deliverableType ?? "unknown"}\n- acceptance: ready=${acceptance.ready} blockers=${acceptance.blockerCount} placeholders=${acceptance.placeholderCount}`,
      );
      const sectionExcerpt = draft.sections
        .slice(0, 4)
        .map((s) => `### ${s.heading}\n${s.body.slice(0, 500)}`)
        .join("\n\n");
      if (sectionExcerpt.trim()) {
        blocks.push(`【草稿章节摘录】\n${sectionExcerpt.slice(0, 4_000)}`);
      }
    }
  }
  if (opts.matterId?.trim()) {
    const openQueue = readQueueItems(workspaceDir, opts.matterId.trim())
      .filter((q) => q.status === "open" || q.status === "in_progress")
      .slice(0, 6);
    if (openQueue.length > 0) {
      blocks.push(
        `【案件待办队列】\n${openQueue.map((q) => `- [${q.priority}] ${q.kind}: ${q.title}`).join("\n")}`,
      );
    }
  }
  if (opts.pendingClarificationKeys?.length) {
    blocks.push(`【待澄清键】\n${opts.pendingClarificationKeys.join(", ")}`);
  }
  return blocks;
}

export function buildPostCompactSystemNote(opts: {
  matterId?: string;
  linkedTaskId?: string;
  pendingClarificationKeys?: string[];
  workspaceDir?: string;
}): string {
  const lines: string[] = ["【压缩后上下文锚点】"];
  if (opts.matterId) {
    lines.push(`- matterId: ${opts.matterId}`);
  }
  if (opts.linkedTaskId) {
    lines.push(`- linkedTaskId: ${opts.linkedTaskId}`);
  }
  if (opts.pendingClarificationKeys?.length) {
    lines.push(`- pendingClarification: ${opts.pendingClarificationKeys.join(", ")}`);
  }
  lines.push("- 交付物验收与 render 门禁仍须遵守当前草稿 acceptance 状态。");
  if (opts.workspaceDir) {
    for (const block of collectCompactAttachmentNotes(opts.workspaceDir, opts)) {
      lines.push("", block);
    }
  }
  return lines.join("\n");
}

export function autoCompactSessionHistory(
  session: AgentSession,
  workspaceDir: string,
  opts: {
    maxHistoryMessages: number;
    policy?: LawMindWorkspacePolicy | null;
    linkedTaskId?: string;
  },
): CompactResult {
  const budget = estimateTokenBudget(session, opts.policy);
  const { autoCompactBufferTokens } = resolveContextPolicy(opts.policy);
  const needsCompact =
    budget.level === "compact" || session.conversationHistory.length > opts.maxHistoryMessages;

  if (!needsCompact) {
    return { messages: session.conversationHistory, compacted: false };
  }

  const beforeLen = session.conversationHistory.length;
  const systemMessages = session.conversationHistory.filter((m) => m.role === "system");
  const summaryText = readSessionSummary(workspaceDir, session.matterId);
  const summaryPath =
    session.matterId && summaryText
      ? sessionSummaryPath(workspaceDir, session.matterId)
      : undefined;

  let nonSystem = session.conversationHistory.filter((m) => m.role !== "system");
  const cutFrom = adjustIndexToPreserveToolPairs(session.conversationHistory);
  if (cutFrom > 0) {
    const cutMsg = session.conversationHistory[cutFrom];
    const cutIdx = nonSystem.findIndex((m) => m === cutMsg);
    if (cutIdx > 0) {
      nonSystem = nonSystem.slice(cutIdx);
    } else {
      nonSystem = nonSystem.slice(-Math.max(8, Math.floor(opts.maxHistoryMessages / 2)));
    }
  } else {
    nonSystem = nonSystem.slice(-opts.maxHistoryMessages);
  }

  const summaryBlock: AgentMessage[] = [];
  if (summaryText) {
    summaryBlock.push({
      role: "system",
      content: `【案件会话摘要】\n${summaryText.slice(0, 12_000)}`,
      timestamp: new Date().toISOString(),
    });
  } else if (session.matterId) {
    const casePath = caseFilePath(workspaceDir, session.matterId);
    try {
      const caseSnippet = fs.readFileSync(casePath, "utf8").slice(0, 2000);
      summaryBlock.push({
        role: "system",
        content: `【案件记忆摘录】\n${caseSnippet}`,
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* no case file */
    }
  }

  summaryBlock.push({
    role: "system",
    content: buildPostCompactSystemNote({
      matterId: session.matterId,
      linkedTaskId: opts.linkedTaskId,
      pendingClarificationKeys: session.pendingClarificationKeys,
      workspaceDir,
    }),
    timestamp: new Date().toISOString(),
  });

  const merged = [...systemMessages.slice(0, 1), ...summaryBlock, ...nonSystem];
  const dropped = Math.max(0, beforeLen - merged.length);

  void autoCompactBufferTokens;

  return {
    messages: compactHistory(merged, opts.maxHistoryMessages + summaryBlock.length + 2),
    compacted: true,
    sessionSummaryPath: summaryPath,
    droppedMessageCount: dropped,
  };
}
