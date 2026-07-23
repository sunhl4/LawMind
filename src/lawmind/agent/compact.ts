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
  /** Extractive digest of dropped dialogue (also reinjected as a system note). */
  droppedDigest?: string;
  /** Messages removed from non-system history (for optional LLM re-digest). */
  droppedSpan?: AgentMessage[];
  /** Rough token estimate of dropped dialogue (chars/4). */
  estimatedDroppedTokens?: number;
};

/** Soft cap for reinjected dropped-span digest (chars). Scales with model window. */
export function resolveCompactDigestCharCap(contextTokens?: number): number {
  const ctx = typeof contextTokens === "number" && contextTokens > 0 ? contextTokens : 128_000;
  return Math.min(24_000, Math.max(6_000, Math.floor(ctx * 0.08)));
}

/**
 * Extractive summarize-then-drop: keep lawyer asks, assistant conclusions, and tool names
 * from messages about to be discarded — no extra model call required.
 */
export function buildDroppedSpanDigest(dropped: AgentMessage[], maxChars: number): string {
  if (dropped.length === 0 || maxChars < 80) {
    return "";
  }
  const toolNames = new Set<string>();
  const lawyerLines: string[] = [];
  const assistantLines: string[] = [];

  for (const msg of dropped) {
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        if (tc.name?.trim()) {
          toolNames.add(tc.name.trim());
        }
      }
    }
    if (msg.role === "tool" && msg.toolCallResponses?.length) {
      for (const tr of msg.toolCallResponses) {
        if (tr.name?.trim()) {
          toolNames.add(tr.name.trim());
        }
      }
    }
    const text = (msg.content ?? "").trim().replace(/\s+/g, " ");
    if (!text) {
      continue;
    }
    if (msg.role === "user") {
      lawyerLines.push(text.slice(0, 400));
    } else if (msg.role === "assistant") {
      assistantLines.push(text.slice(0, 400));
    }
  }

  const header = `【压缩前对话蒸馏】共丢弃约 ${dropped.length} 条消息（含工具轮）；以下为提取要点，完整细节以案件文件与工具重读为准。`;
  const sections: string[] = [header];
  if (lawyerLines.length > 0) {
    const keep = lawyerLines.slice(-8);
    sections.push(`### 律师要点\n${keep.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (assistantLines.length > 0) {
    const keep = assistantLines.slice(-8);
    sections.push(`### 助手结论/回复摘录\n${keep.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (toolNames.size > 0) {
    sections.push(`### 曾调用工具\n${[...toolNames].toSorted().join(", ")}`);
  }
  let out = sections.join("\n\n");
  if (out.length > maxChars) {
    out = `${out.slice(0, Math.max(0, maxChars - 20))}\n…[蒸馏截断]`;
  }
  return out;
}

export function compactDigestPath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "compact-digest.md");
}

/** Best-effort persist of latest compact digest for matter recovery. */
export function writeCompactDigestFile(
  workspaceDir: string,
  matterId: string | undefined,
  digest: string,
): void {
  if (!matterId?.trim() || !digest.trim()) {
    return;
  }
  try {
    const fp = compactDigestPath(workspaceDir, matterId.trim());
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const stamp = new Date().toISOString();
    const prev = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
    const next =
      `# Compact digest\n\n_Updated: ${stamp}_\n\n${digest.trim()}\n\n---\n\n${prev}`.slice(
        0,
        80_000,
      );
    fs.writeFileSync(fp, next, "utf8");
  } catch {
    /* non-fatal */
  }
}

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
    contextTokens?: number;
    /** When false, skip writing compact-digest.md under the matter (dry-run preview). Default true. */
    writeDigestFile?: boolean;
  },
): CompactResult {
  const budget = estimateTokenBudget(session, opts.policy, {
    contextTokens: opts.contextTokens,
  });
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
  let droppedSpan: AgentMessage[] = [];
  const cutFrom = adjustIndexToPreserveToolPairs(session.conversationHistory);
  if (cutFrom > 0) {
    const cutMsg = session.conversationHistory[cutFrom];
    const cutIdx = nonSystem.findIndex((m) => m === cutMsg);
    if (cutIdx > 0) {
      droppedSpan = nonSystem.slice(0, cutIdx);
      nonSystem = nonSystem.slice(cutIdx);
    } else {
      const keep = Math.max(8, Math.floor(opts.maxHistoryMessages / 2));
      droppedSpan = nonSystem.slice(0, Math.max(0, nonSystem.length - keep));
      nonSystem = nonSystem.slice(-keep);
    }
  } else if (nonSystem.length > opts.maxHistoryMessages) {
    droppedSpan = nonSystem.slice(0, nonSystem.length - opts.maxHistoryMessages);
    nonSystem = nonSystem.slice(-opts.maxHistoryMessages);
  }

  const digestCap = resolveCompactDigestCharCap(opts.contextTokens);
  const droppedDigest = buildDroppedSpanDigest(droppedSpan, digestCap);
  if (droppedDigest && opts.writeDigestFile !== false) {
    writeCompactDigestFile(workspaceDir, session.matterId, droppedDigest);
  }

  const summaryCharCap = Math.min(20_000, Math.max(12_000, Math.floor(digestCap * 1.2)));
  const caseSnippetCap = Math.min(6_000, Math.max(2_000, Math.floor(digestCap * 0.35)));

  const summaryBlock: AgentMessage[] = [];
  if (droppedDigest) {
    summaryBlock.push({
      role: "system",
      content: droppedDigest,
      timestamp: new Date().toISOString(),
    });
  }
  if (summaryText) {
    summaryBlock.push({
      role: "system",
      content: `【案件会话摘要】\n${summaryText.slice(0, summaryCharCap)}`,
      timestamp: new Date().toISOString(),
    });
  } else if (session.matterId) {
    const casePath = caseFilePath(workspaceDir, session.matterId);
    try {
      const caseSnippet = fs.readFileSync(casePath, "utf8").slice(0, caseSnippetCap);
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

  const droppedChars = droppedSpan.reduce(
    (n, m) => n + (m.content?.length ?? 0) + JSON.stringify(m.toolCalls ?? []).length,
    0,
  );

  return {
    messages: compactHistory(merged, opts.maxHistoryMessages + summaryBlock.length + 2),
    compacted: true,
    sessionSummaryPath: summaryPath,
    droppedMessageCount: dropped,
    droppedDigest: droppedDigest || undefined,
    droppedSpan: droppedSpan.length > 0 ? droppedSpan : undefined,
    estimatedDroppedTokens: Math.max(1, Math.ceil(droppedChars / 4)),
  };
}
