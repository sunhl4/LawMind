import fs from "node:fs";
import path from "node:path";
import { readQueueItems } from "../adapters/matter-storage/index.js";
import { validateDraftAgainstSpec } from "../deliverables/index.js";
import { draftPath, readDraft } from "../drafts/index.js";
import { caseFilePath } from "../memory/index.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { workspaceRelativePath, writeCompactDropArchive } from "./compact-drop-archive.js";
import { accumulateFactPin } from "./compact-fact-pin.js";
import { insertBeforeLastUserMessage, isCompactSyntheticUserMessage } from "./compact-insert.js";
import { selectTaskPinText } from "./compact-reinjection.js";
import {
  estimateTextTokens,
  estimateTokenBudget,
  historyNominalTokens,
  resolveContextPolicy,
} from "./context-budget.js";
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
  /** CJK-aware token estimate of dropped dialogue (same estimator as the budget). */
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
  const nominal = historyNominalTokens(contextTokens, {
    minContextTokens: tuning.budget.minContextTokens,
    fallbackTokens: tuning.budget.contextTokens,
  });
  return Math.min(maxChars, Math.max(minChars, Math.floor(nominal * charRatio)));
}

/**
 * Extractive summarize-then-drop: keep lawyer asks, assistant conclusions, and tool names
 * from messages about to be discarded — no extra model call required.
 */
/** Statute-like anchors kept after compact so the next model round can still cite. */
const DROPPED_CITATION_RE =
  /《[^《》\n]{1,48}》(?:\s*第\s*(?:\d+|[一二三四五六七八九十百千零〇两]+)\s*条(?:之\d+)?(?:第[一二三四五六七八九十百千\d]+款)?)?|法释〔\d{4}〕\d+号|（\d{4}）[^）\n]{2,24}号|指导性?案例\s*\d{1,4}\s*号/g;

/** 合同内部条号（第 3.2 条）。单独计，避免一整份合同把法条锚点挤掉。 */
const CONTRACT_CLAUSE_RE = /第\s*\d{1,3}(?:\.\d{1,3}){1,3}\s*条/g;
const CONTRACT_CLAUSE_ANCHOR_MAX = 8;

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
  const clausePool: string[] = [];
  const considerClauses = (raw: string): void => {
    if (!raw || clausePool.length >= CONTRACT_CLAUSE_ANCHOR_MAX) {
      return;
    }
    CONTRACT_CLAUSE_RE.lastIndex = 0;
    for (const match of raw.matchAll(CONTRACT_CLAUSE_RE)) {
      const token = (match[0] ?? "").replace(/\s+/g, "");
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);
      clausePool.push(token);
      if (clausePool.length >= CONTRACT_CLAUSE_ANCHOR_MAX) {
        return;
      }
    }
  };
  for (const msg of dropped) {
    consider(msg.content ?? "");
    considerClauses(msg.content ?? "");
    for (const tr of msg.toolCallResponses ?? []) {
      const raw =
        typeof tr.result?.data === "string" ? tr.result.data : JSON.stringify(tr.result ?? "");
      consider(raw);
      considerClauses(raw);
    }
    if (found.length >= maxItems && clausePool.length >= CONTRACT_CLAUSE_ANCHOR_MAX) {
      break;
    }
  }
  for (const token of clausePool) {
    if (found.length >= maxItems) {
      break;
    }
    found.push(token);
  }
  return found;
}

export function buildDroppedSpanDigest(
  dropped: AgentMessage[],
  maxChars: number,
  tuning: ContextTuning = resolveContextTuning(null),
  opts?: { archiveRelPath?: string },
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
    // 合成消息（上次的整理稿 / 红线重注 / 续接种子 / 退让反弹）不是律师发言。
    // 不再嵌进下一轮整理稿：原文在会话旁的归档里，路径写在本篇开头。
    if (isCompactSyntheticUserMessage(text)) {
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

  const header = [
    `【压缩前对话蒸馏】共丢弃约 ${dropped.length} 条消息（含工具轮）；以下为提取要点，完整细节以案件文件与工具重读为准。`,
    opts?.archiveRelPath
      ? `原文另存 ${opts.archiveRelPath}。需要原句时用 analyze_document 按 offset/limit 分页读取，不要把要点当成全文。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const sections: string[] = [header];

  // ── 段落顺序 = 截断优先级 ────────────────────────────────────────────
  // 超预算时是 `slice(0, maxChars)`：**切的是尾巴**，所以越靠前越不会被丢。
  // 排序依据是「丢了会不会让模型答非所问」：任务目标最高，引用次之
  // （法律场景引用错 = 错误交付），其后是要点、结论，工具名最低。
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

function estimateHistoryMessageTokens(msg: AgentMessage): number {
  let tokens = estimateTextTokens(msg.content ?? "");
  if (msg.toolCalls?.length) {
    tokens += estimateTextTokens(JSON.stringify(msg.toolCalls));
  }
  if (msg.toolCallResponses?.length) {
    tokens += estimateTextTokens(JSON.stringify(msg.toolCallResponses));
  }
  return tokens;
}

type TailGroup = { start: number; end: number; tokens: number; count: number };

/** 非 system 消息按「一条」或「一次工具调用加紧随的 tool 结果」分组。 */
function nonSystemTailGroups(messages: readonly AgentMessage[]): TailGroup[] {
  const groups: TailGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (!msg || msg.role === "system") {
      i += 1;
      continue;
    }
    let end = i + 1;
    if (msg.role === "assistant" && (msg.toolCalls?.length ?? 0) > 0) {
      while (end < messages.length && messages[end]?.role === "tool") {
        end += 1;
      }
    }
    let tokens = 0;
    for (let j = i; j < end; j += 1) {
      const item = messages[j];
      if (item) {
        tokens += estimateHistoryMessageTokens(item);
      }
    }
    groups.push({ start: i, end, tokens, count: end - i });
    i = end;
  }
  return groups;
}

/**
 * 压缩切点：从最新消息往前装，装到 token 预算用尽。
 *
 * 一组工具调用整组进或整组出。条数只做两件事：至少留下 `minTailMessages`
 * （正在办的那几轮，超预算也留），至多留下 `maxTailMessages`。
 * 返回值是全量历史里的下标；`0` 表示不用丢。
 */
export function cutIndexForTokenTail(
  messages: AgentMessage[],
  opts: {
    tailTokenBudget: number;
    minTailMessages: number;
    maxTailMessages: number;
  },
): number {
  const groups = nonSystemTailGroups(messages);
  if (groups.length === 0) {
    return 0;
  }
  const minKeep = Math.max(0, opts.minTailMessages);
  const maxKeep = Math.max(minKeep, opts.maxTailMessages);
  const budget = Math.max(0, opts.tailTokenBudget);
  let keptTokens = 0;
  let keptCount = 0;
  let cutStart = messages.length;
  for (let g = groups.length - 1; g >= 0; g -= 1) {
    const group = groups[g];
    if (!group) {
      break;
    }
    const nextCount = keptCount + group.count;
    const nextTokens = keptTokens + group.tokens;
    const belowFloor = keptCount < minKeep;
    if (!belowFloor && (nextCount > maxKeep || nextTokens > budget)) {
      break;
    }
    keptTokens = nextTokens;
    keptCount = nextCount;
    cutStart = group.start;
  }
  const firstNonSystem = groups[0]?.start ?? 0;
  if (cutStart <= firstNonSystem) {
    return 0;
  }
  return alignCutIndexToToolGroups(messages, cutStart);
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
      const rel = workspaceRelativePath(workspaceDir, draftPath(workspaceDir, taskId));
      blocks.push(
        `【关联草稿 ${taskId}】\n- 类型: ${draft.deliverableType ?? "unknown"}\n- 路径: ${rel}\n- acceptance: ready=${acceptance.ready} blockers=${acceptance.blockerCount} placeholders=${acceptance.placeholderCount}`,
      );
      const headings = draft.sections
        .map((section) => section.heading.trim())
        .filter(Boolean)
        .slice(0, 8);
      if (headings.length > 0) {
        blocks.push(
          `【草稿章节】\n${headings.map((heading) => `- ${heading}`).join("\n")}\n正文在上面的路径里，用工具读取，不要凭记忆改稿。`,
        );
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
      `- 待澄清键（缺口标【待核实】进稿，不因此停写）: ${opts.pendingClarificationKeys.join(", ")}`,
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

function fileHasBody(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).size > 0;
  } catch {
    return false;
  }
}

/** 案件摘要和档案只给路径。正文留给工具按 offset 读。 */
function matterMaterialPaths(
  workspaceDir: string,
  matterId: string | undefined,
  summaryAbs: string | undefined,
): string | undefined {
  const lines: string[] = [];
  if (summaryAbs && fileHasBody(summaryAbs)) {
    lines.push(`- 案件会话摘要: ${workspaceRelativePath(workspaceDir, summaryAbs)}`);
  }
  if (matterId?.trim()) {
    const caseAbs = caseFilePath(workspaceDir, matterId.trim());
    if (fileHasBody(caseAbs)) {
      lines.push(`- 案件档案: ${workspaceRelativePath(workspaceDir, caseAbs)}`);
    }
  }
  if (lines.length === 0) {
    return undefined;
  }
  return [
    "【案件材料路径】",
    ...lines,
    "需要时用 analyze_document 按 offset/limit 读取，不要凭记忆补写正文。",
  ].join("\n");
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
  const summaryAbs = session.matterId
    ? sessionSummaryPath(workspaceDir, session.matterId)
    : undefined;
  const summaryPath = summaryAbs && fileHasBody(summaryAbs) ? summaryAbs : undefined;

  let nonSystem = session.conversationHistory.filter((m) => m.role !== "system");
  let droppedSpan: AgentMessage[] = [];
  const digestCap = resolveCompactDigestCharCap(opts.contextTokens, tuning);
  const systemTokens = systemMessages[0] ? estimateHistoryMessageTokens(systemMessages[0]) : 0;
  // 摘要按字符帽预留（中文约 1 字 1 token），再留压缩后锚点。尾巴装满后再塞摘要会把窗口顶回去。
  const tailTokenBudget = Math.max(0, budget.effectiveLimit - systemTokens - digestCap - 1_500);
  const cutFrom = cutIndexForTokenTail(session.conversationHistory, {
    tailTokenBudget,
    minTailMessages: tuning.midTurn.elideKeepTail,
    maxTailMessages: Math.max(tuning.midTurn.elideKeepTail, opts.maxHistoryMessages),
  });
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
      const text = (msg.content ?? "").trim();
      if (!text || isCompactSyntheticUserMessage(text)) {
        continue;
      }
      const pinned = selectTaskPinText(text, tuning.pins.taskCharCap);
      if (!pinned) {
        continue;
      }
      session.taskPin = {
        text: pinned,
        at: new Date().toISOString(),
      };
      break;
    }
  }

  const boundaryId = `${new Date().toISOString()}#${droppedSpan.length}`;
  const persistAside = opts.writeDigestFile !== false;
  const archiveRelPath =
    persistAside && droppedSpan.length > 0
      ? writeCompactDropArchive({
          workspaceDir,
          sessionId: session.sessionId,
          boundaryId,
          messages: droppedSpan,
        })
      : undefined;

  const droppedDigest = buildDroppedSpanDigest(
    droppedSpan,
    digestCap,
    tuning,
    archiveRelPath ? { archiveRelPath } : {},
  );
  if (droppedDigest && persistAside) {
    writeCompactDigestFile(workspaceDir, session.matterId, droppedDigest);
  }

  const summaryBlock: AgentMessage[] = [];
  if (droppedDigest) {
    summaryBlock.push({
      role: "user",
      content: droppedDigest,
      timestamp: new Date().toISOString(),
      hiddenFromLawyer: true,
    });
  }
  const materialPaths = matterMaterialPaths(workspaceDir, session.matterId, summaryPath);
  if (materialPaths) {
    summaryBlock.push({
      role: "user",
      content: materialPaths,
      timestamp: new Date().toISOString(),
      hiddenFromLawyer: true,
    });
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
    hiddenFromLawyer: true,
  });

  const keptHead = [...systemMessages.slice(0, 1), ...nonSystem];
  const merged = insertBeforeLastUserMessage(keptHead, summaryBlock);
  const dropped = Math.max(0, beforeLen - merged.length);

  void autoCompactBufferTokens;

  const droppedTokens = droppedSpan.reduce((n, m) => n + estimateHistoryMessageTokens(m), 0);

  const capped = compactHistory(merged, opts.maxHistoryMessages + summaryBlock.length + 2);
  const normalized = normalizeToolResultMessages(capped);
  const messages = normalized.changed ? normalized.messages : capped;
  const firstKept = messages.find((m) => m.role !== "system");

  return {
    messages,
    compacted: true,
    sessionSummaryPath: summaryPath,
    droppedMessageCount: dropped,
    droppedDigest: droppedDigest || undefined,
    droppedSpan: droppedSpan.length > 0 ? droppedSpan : undefined,
    estimatedDroppedTokens: Math.max(1, droppedTokens),
    firstKeptTimestamp: firstKept?.timestamp,
    firstKeptRole: firstKept?.role,
    boundaryId,
  };
}
