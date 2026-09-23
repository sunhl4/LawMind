import fs from "node:fs";
import path from "node:path";
import { readQueueItems } from "../adapters/matter-storage/index.js";
import { validateDraftAgainstSpec } from "../deliverables/index.js";
import { readDraft } from "../drafts/index.js";
import { caseFilePath } from "../memory/index.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { accumulateFactPin } from "./compact-fact-pin.js";
import { insertBeforeLastUserMessage, isCompactSyntheticUserMessage } from "./compact-insert.js";
import { estimateTokenBudget, resolveContextPolicy } from "./context-budget.js";
import { type ContextTuning, resolveContextTuning } from "./context-tuning.js";
import {
  alignCutIndexToToolGroups,
  normalizeToolResultMessages,
  sliceKeepingToolGroups,
} from "./session-tool-call-pairing.js";
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
  /** Audit: first kept non-system message after cut. */
  firstKeptTimestamp?: string;
  firstKeptRole?: AgentMessage["role"];
  /** Stable id for this compact boundary (ISO + short suffix). */
  boundaryId?: string;
};

/** Soft cap for reinjected dropped-span digest (chars). Scales with model window. */
export function resolveCompactDigestCharCap(
  contextTokens?: number,
  tuning: ContextTuning = resolveContextTuning(null),
): number {
  const { charRatio, minChars, maxChars } = tuning.digest;
  const ctx =
    typeof contextTokens === "number" && contextTokens > 0
      ? contextTokens
      : tuning.budget.contextTokens;
  return Math.min(maxChars, Math.max(minChars, Math.floor(ctx * charRatio)));
}

/**
 * Extractive summarize-then-drop: keep lawyer asks, assistant conclusions, and tool names
 * from messages about to be discarded — no extra model call required.
 */
/** Statute-like anchors kept after compact so the next model round can still cite. */
const DROPPED_CITATION_RE =
  /《[^《》\n]{1,48}》(?:\s*第\s*(?:\d+|[一二三四五六七八九十百千零〇两]+)\s*条(?:之\d+)?(?:第[一二三四五六七八九十百千\d]+款)?)?|法释〔\d{4}〕\d+号|（\d{4}）[^）\n]{2,24}号/g;

export function collectDroppedCitationAnchors(dropped: AgentMessage[], maxItems = 24): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const consider = (raw: string): void => {
    if (!raw || found.length >= maxItems) {
      return;
    }
    DROPPED_CITATION_RE.lastIndex = 0;
    for (const match of raw.matchAll(DROPPED_CITATION_RE)) {
      const token = (match[0] ?? "").replace(/\s+/g, "");
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);
      found.push(token);
      if (found.length >= maxItems) {
        return;
      }
    }
  };
  for (const msg of dropped) {
    consider(msg.content ?? "");
    for (const tr of msg.toolCallResponses ?? []) {
      consider(
        typeof tr.result?.data === "string" ? tr.result.data : JSON.stringify(tr.result ?? ""),
      );
    }
    if (found.length >= maxItems) {
      break;
    }
  }
  return found;
}

export function buildDroppedSpanDigest(
  dropped: AgentMessage[],
  maxChars: number,
  tuning: ContextTuning = resolveContextTuning(null),
): string {
  const d = tuning.digest;
  if (dropped.length === 0 || maxChars < 80) {
    return "";
  }
  const toolNames = new Set<string>();
  const lawyerLines: string[] = [];
  const assistantLines: string[] = [];
  /** 任务陈述候选：被丢弃区段里**最早的真实**律师发言（原文保留，见下）。 */
  const taskLines: string[] = [];
  /** 此前的整理稿：**不当作律师发言**，单独接续（见下）。 */
  const carriedDigests: string[] = [];

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
    // ── 合成消息（上次的整理稿 / 红线重注 / 续接种子 / 退让反弹）─────────────
    // 与 Codex 的 `collect_user_messages()` 同一取向：**此前的摘要不算用户消息**
    // （上游是 `filter(… previous summaries)`）。不这么做会有两个后果，实测都出现过：
    //   1. 旧摘要在下一轮被当成一条「律师要点」再按行截断 → **摘要的摘要**逐层衰减；
    //   2. 它还要与真实律师发言争抢「末 N 条」窗口，一挤就整条丢。
    // 这里改为**单独接续**：原样带上、显式标注来源，不再伪装成律师发言。
    if (isCompactSyntheticUserMessage(text)) {
      carriedDigests.push(text);
      continue;
    }
    const lineCap = Math.min(
      d.lawyerLineMaxChars,
      Math.max(d.lawyerLineMinChars, Math.floor(maxChars * d.lawyerLineRatio)),
    );
    if (msg.role === "user") {
      if (taskLines.length < d.taskLineMax) {
        taskLines.push(text);
      }
      lawyerLines.push(text.slice(0, lineCap));
    } else if (msg.role === "assistant") {
      assistantLines.push(text.slice(0, lineCap));
    }
  }

  const header = `【压缩前对话蒸馏】共丢弃约 ${dropped.length} 条消息（含工具轮）；以下为提取要点，完整细节以案件文件与工具重读为准。`;
  const sections: string[] = [header];

  // ── 段落顺序 = 截断优先级 ────────────────────────────────────────────
  // 超预算时是 `slice(0, maxChars)`：**切的是尾巴**，所以越靠前越不会被丢。
  // 排序依据是「丢了会不会让模型答非所问」：任务目标最高，引用次之
  // （法律场景引用错 = 错误交付），其后是历史整理稿、要点、结论，工具名最低。
  if (taskLines.length > 0) {
    // 任务陈述按**原文**保留（不按行截断）：Codex 保最多 20k token 的原始用户消息，
    // 正是为了「目标不丢」。提取式要点里一句「请继续核对付款」替代不了「要做什么」。
    const taskCap = Math.min(
      d.taskMaxChars,
      Math.max(d.taskMinChars, Math.floor(maxChars * d.taskRatio)),
    );
    sections.push(
      `### 任务与目标（原文保留，最早一条律师发言）\n${taskLines
        .map((line) => `- ${line.slice(0, taskCap)}`)
        .join("\n")}`,
    );
  }
  const citations = collectDroppedCitationAnchors(dropped, d.citationAnchorMax);
  if (citations.length > 0) {
    sections.push(`### 压缩前引用\n${citations.join("；")}`);
  }
  if (carriedDigests.length > 0) {
    const carriedCap = Math.max(d.carriedMinChars, Math.floor(maxChars * d.carriedRatio));
    // 沿用原文（含它自己的分节），让模型看得出这是「上一轮整理稿」而不是律师新说的话。
    const carried = carriedDigests.join("\n\n");
    sections.push(`### 上一轮整理稿（接续保留，非律师新发言）\n${carried.slice(0, carriedCap)}`);
  }
  if (lawyerLines.length > 0) {
    const keep = lawyerLines.slice(-d.recentLineKeep);
    sections.push(`### 律师要点\n${keep.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (assistantLines.length > 0) {
    const keep = assistantLines.slice(-d.recentLineKeep);
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

/**
 * 保留最近 24 条非 system 消息，但切点落在一组 tool 结果中间时整组退回，
 * 避免 firstKept 是孤立 tool（DeepSeek：tool 必须紧跟 tool_calls）。
 */
export function adjustIndexToPreserveToolPairs(messages: AgentMessage[]): number {
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (nonSystem.length <= 8) {
    return 0;
  }
  const keepFrom = Math.max(0, nonSystem.length - 24);
  const anchor = nonSystem[keepFrom];
  if (!anchor) {
    return 0;
  }
  const idx = messages.findIndex((m) => m === anchor);
  if (idx <= 0) {
    return 0;
  }
  return alignCutIndexToToolGroups(messages, idx);
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
    // 措辞必须与承前种子（`session-carryover.ts` 的状态头）一致：把「活的门禁」
    // 写成裸键名，模型无法区分「上一轮的一句备注」与「现在仍生效的硬门禁」。
    // 压缩路径与分叉路径对同一件事说不同的话，正是静默失效的温床。
    lines.push(
      `- 待澄清键（仍生效，未答齐前不得起草/渲染）: ${opts.pendingClarificationKeys.join(", ")}`,
    );
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
    /** 已解析的调参；不传则从 `policy` 现场解析（默认值 = 接入 policy 前的行为）。 */
    tuning?: ContextTuning;
  },
): CompactResult {
  const tuning = opts.tuning ?? resolveContextTuning(opts.policy);
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
  if (cutFrom >= session.conversationHistory.length) {
    droppedSpan = nonSystem;
    nonSystem = [];
  } else if (cutFrom > 0) {
    const cutMsg = session.conversationHistory[cutFrom];
    const cutIdx = nonSystem.findIndex((m) => m === cutMsg);
    if (cutIdx > 0) {
      droppedSpan = nonSystem.slice(0, cutIdx);
      nonSystem = nonSystem.slice(cutIdx);
    } else {
      const sliced = sliceKeepingToolGroups(
        nonSystem,
        Math.max(8, Math.floor(opts.maxHistoryMessages / 2)),
      );
      droppedSpan = sliced.dropped;
      nonSystem = sliced.kept;
    }
  } else if (nonSystem.length > opts.maxHistoryMessages) {
    const sliced = sliceKeepingToolGroups(nonSystem, opts.maxHistoryMessages);
    droppedSpan = sliced.dropped;
    nonSystem = sliced.kept;
  }

  // ── 任务锚点（钉子）在这里补齐 ─────────────────────────────────────
  // 压缩正是「原始任务陈述即将离开窗口」的那一刻，也是最后能可靠读到它的地方。
  // 只补不改：runTurn 在首轮就已确定钉子（首选来源）；这里覆盖的是直接调用压缩的
  // 入口（手动整理、回合内整理、单测），让机制不依赖「必须先跑过一轮」。
  // 事实台账兜底：覆盖直接调用压缩的入口（手动整理、回合内整理、单测、基准）。
  accumulateFactPin(
    session,
    droppedSpan.length > 0 ? droppedSpan : session.conversationHistory,
    tuning.pins,
  );
  if (!session.taskPin?.text) {
    const pool = droppedSpan.length > 0 ? droppedSpan : session.conversationHistory;
    for (const msg of pool) {
      if (msg.role !== "user") {
        continue;
      }
      const text = (msg.content ?? "").trim().replace(/\s+/g, " ");
      if (!text || isCompactSyntheticUserMessage(text)) {
        continue;
      }
      session.taskPin = {
        text: text.slice(0, tuning.pins.taskCharCap),
        at: new Date().toISOString(),
      };
      break;
    }
  }

  const digestCap = resolveCompactDigestCharCap(opts.contextTokens, tuning);
  const droppedDigest = buildDroppedSpanDigest(droppedSpan, digestCap, tuning);
  if (droppedDigest && opts.writeDigestFile !== false) {
    writeCompactDigestFile(workspaceDir, session.matterId, droppedDigest);
  }

  const summaryCharCap = Math.min(20_000, Math.max(12_000, Math.floor(digestCap * 1.2)));
  const caseSnippetCap = Math.min(6_000, Math.max(2_000, Math.floor(digestCap * 0.35)));

  const summaryBlock: AgentMessage[] = [];
  if (droppedDigest) {
    summaryBlock.push({
      role: "user",
      content: droppedDigest,
      timestamp: new Date().toISOString(),
    });
  }
  if (summaryText) {
    summaryBlock.push({
      role: "user",
      content: `【案件会话摘要】\n${summaryText.slice(0, summaryCharCap)}`,
      timestamp: new Date().toISOString(),
    });
  } else if (session.matterId) {
    const casePath = caseFilePath(workspaceDir, session.matterId);
    try {
      const caseSnippet = fs.readFileSync(casePath, "utf8").slice(0, caseSnippetCap);
      summaryBlock.push({
        role: "user",
        content: `【案件记忆摘录】\n${caseSnippet}`,
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* no case file */
    }
  }

  summaryBlock.push({
    role: "user",
    content: buildPostCompactSystemNote({
      matterId: session.matterId,
      linkedTaskId: opts.linkedTaskId,
      pendingClarificationKeys: session.pendingClarificationKeys,
      workspaceDir,
    }),
    timestamp: new Date().toISOString(),
  });

  const keptHead = [...systemMessages.slice(0, 1), ...nonSystem];
  const merged = insertBeforeLastUserMessage(keptHead, summaryBlock);
  const dropped = Math.max(0, beforeLen - merged.length);

  void autoCompactBufferTokens;

  const droppedChars = droppedSpan.reduce(
    (n, m) => n + (m.content?.length ?? 0) + JSON.stringify(m.toolCalls ?? []).length,
    0,
  );

  const capped = compactHistory(merged, opts.maxHistoryMessages + summaryBlock.length + 2);
  const normalized = normalizeToolResultMessages(capped);
  const messages = normalized.changed ? normalized.messages : capped;
  const firstKept = messages.find((m) => m.role !== "system");
  const boundaryId = `${new Date().toISOString()}#${dropped}`;

  return {
    messages,
    compacted: true,
    sessionSummaryPath: summaryPath,
    droppedMessageCount: dropped,
    droppedDigest: droppedDigest || undefined,
    droppedSpan: droppedSpan.length > 0 ? droppedSpan : undefined,
    estimatedDroppedTokens: Math.max(1, Math.ceil(droppedChars / 4)),
    firstKeptTimestamp: firstKept?.timestamp,
    firstKeptRole: firstKept?.role,
    boundaryId,
  };
}
