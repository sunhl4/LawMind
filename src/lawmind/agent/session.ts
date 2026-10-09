/**
 * Agent Session Persistence
 *
 * 每个对话是一个 session，session 持久化到磁盘，
 * 支持断点续做：关闭后重新打开，agent 能恢复上下文。
 *
 * 存储结构：
 *   workspace/sessions/<sessionId>.json — session 元数据 + conversation history
 *   workspace/sessions/<sessionId>.turns.jsonl — 每个 turn 的完整记录（追加写入）
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { appendTranscriptLines } from "../adapters/session-transcript/index.js";
import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import {
  projectAssistantProseForSampling,
  projectToolResultForSampling,
  renderEngineReadings,
} from "./factor-state.js";
import { projectLawyerChatBubbles } from "./lawyer-chat-projection.js";
import {
  formatRemainingTokensNote,
  shouldInjectRemainingTokensNote,
  withEphemeralBudgetNote,
  withEphemeralTurnContext,
} from "./prompt-fragments.js";
import { slimSessionForDesk, writeSessionDeskSnapshot } from "./session-desk-snapshot.js";
import { persistOrThrow } from "./session-persist.js";
import {
  hasOpenToolGroup,
  normalizeToolResultMessages,
  repairToolCallPairing,
  rewriteUnfinishedToolPlaceholders,
  sliceKeepingToolGroups,
} from "./session-tool-call-pairing.js";
import type { AgentMessage, AgentSession, AgentTurn, PersistedChatLiveTrace } from "./types.js";

const SESSIONS_DIR = "sessions";
const MAX_HISTORY_DEFAULT = 40;

/** 与 Cursor 新对话默认名一致 */
export const DEFAULT_CHAT_SESSION_TITLE = "New Chat";

/** 自动标题最大长度（按字素截断，避免标签过长） */
export const AUTO_CHAT_TITLE_MAX_LENGTH = 72;

export function displayChatSessionTitle(session: Pick<AgentSession, "title">): string {
  const t = session.title?.trim();
  return t && t.length > 0 ? t : DEFAULT_CHAT_SESSION_TITLE;
}

/** 侧栏会话列表。协作子回合留在在办，不和律师的对话混在一起。 */
export function isLawyerChatSwitcherSession(
  session: Pick<AgentSession, "omitFromChatSwitcher" | "collaborationDelegationId">,
): boolean {
  return session.omitFromChatSwitcher !== true && !session.collaborationDelegationId?.trim();
}

function firstNonEmptyLine(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) {
      return t;
    }
  }
  return "";
}

/** 从写入模型的完整 instruction 中跳过 LawMind 注入块，取用户真正提问的首行（无 hint 时的回退） */
function firstUserQuestionLineFromInstruction(instruction: string): string {
  for (const line of instruction.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    if (
      t.startsWith("【") &&
      (t.includes("LawMind") || t.includes("文件页") || t.includes("会议议程"))
    ) {
      continue;
    }
    if (t === "---" || t.startsWith("---")) {
      continue;
    }
    if (t.startsWith("- [") && (t.includes("工作区") || t.includes("项目"))) {
      continue;
    }
    if (t.startsWith("【本会发言主题】")) {
      const inner = t.replace(/^【本会发言主题】\s*/, "").trim();
      if (inner) {
        return inner;
      }
      continue;
    }
    return t;
  }
  return firstNonEmptyLine(instruction);
}

/** 从一段正文中取「第一句」（遇中英文句号、问号、叹号、省略号为止；无则取整段折叠空白后截断）。 */
export function extractFirstSentenceFromUserMessageParagraph(text: string): string {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t) {
    return "";
  }
  const terminators = /[.!?。！？…]/;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (terminators.test(ch)) {
      return t.slice(0, i + 1).trim();
    }
  }
  return t.replace(/\s+/g, " ").trim();
}

function truncateTitleByGraphemes(s: string, max: number): string {
  try {
    const seg = new Intl.Segmenter("und", { granularity: "grapheme" });
    const parts = [...seg.segment(s)];
    if (parts.length <= max) {
      return s;
    }
    return parts
      .slice(0, max)
      .map((x) => x.segment)
      .join("")
      .trimEnd();
  } catch {
    return s.length > max ? s.slice(0, max).trimEnd() : s;
  }
}

/**
 * 从首条用户消息解析第一句并生成会话标题（仍为 New Chat 时使用）。
 * 先取首段（空行分段），再按句末标点切第一句，空白折叠后按字素截断。
 */
export function deriveAutoChatTitleFromFirstUserMessage(raw: string): string | undefined {
  const block = raw.replace(/^\uFEFF/, "").trim();
  if (!block) {
    return undefined;
  }
  const firstPara = block.split(/\r?\n\s*\r?\n/)[0]?.trim() ?? block;
  const sentence = extractFirstSentenceFromUserMessageParagraph(firstPara);
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  const clipped = truncateTitleByGraphemes(collapsed, AUTO_CHAT_TITLE_MAX_LENGTH);
  return clipped.length > 0 ? clipped : undefined;
}

function sessionsDir(workspaceDir: string): string {
  return path.join(workspaceDir, SESSIONS_DIR);
}

function sessionFilePath(workspaceDir: string, sessionId: string): string {
  return path.join(sessionsDir(workspaceDir), `${sessionId}.json`);
}

function turnsFilePath(workspaceDir: string, sessionId: string): string {
  return path.join(sessionsDir(workspaceDir), `${sessionId}.turns.jsonl`);
}

export function createSession(opts: {
  workspaceDir: string;
  matterId?: string;
  actorId: string;
  assistantId?: string;
  title?: string;
}): AgentSession {
  const rawTitle = opts.title?.trim();
  const session: AgentSession = {
    sessionId: randomUUID(),
    title: rawTitle && rawTitle.length > 0 ? rawTitle.slice(0, 200) : DEFAULT_CHAT_SESSION_TITLE,
    matterId: opts.matterId,
    actorId: opts.actorId,
    assistantId: opts.assistantId,
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  persistOrThrow("session", () => {
    writeJsonAtomic(sessionFilePath(opts.workspaceDir, session.sessionId), session);
  });

  return session;
}

export function loadSession(workspaceDir: string, sessionId: string): AgentSession | undefined {
  const filePath = sessionFilePath(workspaceDir, sessionId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const session = JSON.parse(raw) as AgentSession;
    // Older sessions wrote compact digests without the flag; keep them model-only.
    for (const msg of session.conversationHistory ?? []) {
      if (
        msg.role === "user" &&
        !msg.hiddenFromLawyer &&
        isCompactSyntheticUserMessage(msg.content ?? "")
      ) {
        msg.hiddenFromLawyer = true;
      }
    }
    return session;
  } catch {
    return undefined;
  }
}

/**
 * 工具批次落盘屏障（Claude Code #31328 同类故障的防线）。
 *
 * 批次执行中，内存历史天然是半批的（assistant(tool_calls) 已有、结果还在逐条
 * push）。此期间落盘不能写原始的半批状态，而要写「已配对快照」：缺结果的调用
 * 补占位、孤儿结果丢掉。于是磁盘上的 session.json 任何时候都能直接送出。
 *
 * 批次结束时 {@link commitSessionToolBatch} 把完整历史归一化后写一次，
 * 保证「一批调用的 assistant + 全部结果」整体落盘。
 *
 * 刻意不采用「批次期间跳过写入」：那会让 saveSession 的「返回即落盘」契约失效，
 * 与 session-persist 的 fail-closed 取向相反（重命名标题之类的并发写入会被静默丢弃）。
 */
const openToolBatches = new Map<string, number>();

export function beginSessionToolBatch(sessionId: string): void {
  openToolBatches.set(sessionId, (openToolBatches.get(sessionId) ?? 0) + 1);
}

export function isSessionToolBatchOpen(sessionId: string): boolean {
  return (openToolBatches.get(sessionId) ?? 0) > 0;
}

/** 历史是否已双向配对；未配对时返回补好的副本，已配对则原样返回。 */
function pairToolHistory(history: AgentMessage[]): AgentMessage[] {
  const rewritten = rewriteUnfinishedToolPlaceholders(history);
  const normalized = normalizeToolResultMessages(rewritten.messages);
  const pairing = repairToolCallPairing(normalized.messages);
  if (!rewritten.changed && !normalized.changed && pairing.repairedToolCallIds.length === 0) {
    return history;
  }
  return pairing.messages;
}

/** 批次执行中：落盘改用已配对快照，绝不写半批状态。 */
function persistableSnapshot(session: AgentSession): AgentSession {
  const history = session.conversationHistory ?? [];
  // 屏障标记覆盖正常批次；hasOpenToolGroup 兜住「绕过屏障直接写出半批」的未来回归。
  if (!isSessionToolBatchOpen(session.sessionId) && !hasOpenToolGroup(history)) {
    return session;
  }
  const paired = pairToolHistory(history);
  if (paired === history) {
    return session;
  }
  return { ...session, conversationHistory: paired };
}

/** 结束批次，把完整（且已配对）的历史整体写盘一次。异常路径同样必须调用。 */
export function commitSessionToolBatch(workspaceDir: string, session: AgentSession): void {
  const depth = openToolBatches.get(session.sessionId) ?? 0;
  if (depth > 1) {
    openToolBatches.set(session.sessionId, depth - 1);
    return;
  }
  openToolBatches.delete(session.sessionId);
  // 中断/异常路径可能留下未闭合的组：先补占位，再整体落盘。
  session.conversationHistory = pairToolHistory(session.conversationHistory);
  saveSession(workspaceDir, session);
}

export function saveSession(workspaceDir: string, session: AgentSession): void {
  session.updatedAt = new Date().toISOString();
  // 原子写（temp+rename）：崩溃不留半写 session.json。
  // 保持同步语义：resume/级联等调用方依赖「返回即落盘」。失败必须抛出，禁止继续采样。
  const target = persistableSnapshot(session);
  persistOrThrow("session", () => {
    writeJsonAtomic(sessionFilePath(workspaceDir, session.sessionId), target);
    try {
      writeSessionDeskSnapshot(workspaceDir, target);
    } catch {
      /* 目录索引写失败时，下次打开在办会从完整会话重建 */
    }
    const last = target.conversationHistory[target.conversationHistory.length - 1];
    if (last) {
      const transcriptOpts = session.collaborationDelegationId
        ? { delegationId: session.collaborationDelegationId }
        : undefined;
      appendTranscriptLines(workspaceDir, session.sessionId, [last], transcriptOpts);
    }
  });
}

/** 删除会话磁盘文件（json / turns / transcript / events / 侧车 / 回合租约 / spills / drops）。至少删掉一个文件则返回 true。 */
export function deleteSession(workspaceDir: string, sessionId: string): boolean {
  const jsonPath = sessionFilePath(workspaceDir, sessionId);
  const deskPath = path.join(sessionsDir(workspaceDir), `${sessionId}.desk.json`);
  const turnsPath = turnsFilePath(workspaceDir, sessionId);
  const transcript = path.join(sessionsDir(workspaceDir), `${sessionId}.transcript.jsonl`);
  const eventsPath = path.join(sessionsDir(workspaceDir), `${sessionId}.events.jsonl`);
  const pendingPins = path.join(sessionsDir(workspaceDir), `${sessionId}.pending-pins.json`);
  const pendingSteer = path.join(sessionsDir(workspaceDir), `${sessionId}.pending-steer.json`);
  const pendingFollowup = path.join(
    sessionsDir(workspaceDir),
    `${sessionId}.pending-followup.json`,
  );
  const turnGate = path.join(sessionsDir(workspaceDir), `${sessionId}.turn-gate.json`);
  const spillsDir = path.join(sessionsDir(workspaceDir), `${sessionId}.spills`);
  const dropsDir = path.join(sessionsDir(workspaceDir), `${sessionId}.drops`);
  try {
    let did = false;
    for (const p of [
      jsonPath,
      deskPath,
      turnsPath,
      transcript,
      eventsPath,
      pendingPins,
      `${pendingPins}.inflight`,
      pendingSteer,
      `${pendingSteer}.inflight`,
      pendingFollowup,
      turnGate,
    ]) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        did = true;
      }
    }
    for (const dir of [spillsDir, dropsDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        did = true;
      }
    }
    return did;
  } catch {
    return false;
  }
}

export function renameSession(
  workspaceDir: string,
  sessionId: string,
  title: string,
): AgentSession | undefined {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return undefined;
  }
  const t = title.trim().slice(0, 200);
  if (!t) {
    return session;
  }
  session.title = t;
  saveSession(workspaceDir, session);
  return session;
}

const PLAN_HANDOFF_MAX = 2400;

/** Persist Plan→Execute handoff onto session.json (Wave 4). */
export function setSessionPlanHandoff(
  workspaceDir: string,
  sessionId: string,
  planText: string,
  updatedAt?: string,
): AgentSession | undefined {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return undefined;
  }
  const text = planText.trim().slice(0, PLAN_HANDOFF_MAX);
  if (!text) {
    delete session.planHandoff;
    saveSession(workspaceDir, session);
    return session;
  }
  session.planHandoff = {
    planText: text,
    updatedAt: updatedAt?.trim() || new Date().toISOString(),
  };
  saveSession(workspaceDir, session);
  return session;
}

export function clearSessionPlanHandoff(
  workspaceDir: string,
  sessionId: string,
): AgentSession | undefined {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return undefined;
  }
  if (!session.planHandoff) {
    return session;
  }
  delete session.planHandoff;
  saveSession(workspaceDir, session);
  return session;
}

/**
 * 若标题仍为默认「New Chat」，用首条用户消息解析出的「第一句」自动命名。
 * `sessionTitleHint` 为输入框原文（不含文件引用等前缀）；缺省时从 `instruction` 中跳过注入前缀后解析。
 */
export function maybeUpdateSessionTitleFromInstruction(
  session: AgentSession,
  instruction: string,
  sessionTitleHint?: string,
): boolean {
  if (displayChatSessionTitle(session) !== DEFAULT_CHAT_SESSION_TITLE) {
    return false;
  }
  const source = sessionTitleHint?.trim().length
    ? sessionTitleHint.trim()
    : firstUserQuestionLineFromInstruction(instruction);
  const derived = deriveAutoChatTitleFromFirstUserMessage(source);
  if (!derived) {
    return false;
  }
  session.title = derived.slice(0, 200);
  return true;
}

/**
 * 桌面气泡：律师打的一句对应一个回答窗口。
 * 压缩锚点、反弹备注不出现；工具轮里的过程话不进窗口，只留最后那段正文。
 */
export function sessionHistoryToSimpleMessages(session: AgentSession): Array<{
  role: "user" | "assistant";
  text: string;
  liveTrace?: { active: boolean; currentRound?: number; steps: PersistedChatLiveTrace["steps"] };
  executionState?: AgentMessage["executionState"];
  requiresAction?: AgentTurn["requiresAction"];
  turnPlan?: AgentMessage["turnPlan"];
}> {
  const out: Array<{
    role: "user" | "assistant";
    text: string;
    liveTrace?: { active: boolean; currentRound?: number; steps: PersistedChatLiveTrace["steps"] };
    executionState?: AgentMessage["executionState"];
    requiresAction?: AgentTurn["requiresAction"];
    turnPlan?: AgentMessage["turnPlan"];
  }> = projectLawyerChatBubbles(session.conversationHistory).map((bubble) => ({
    role: bubble.role,
    text: bubble.text,
    ...(bubble.liveTrace
      ? {
          liveTrace: {
            active: false,
            currentRound: bubble.liveTrace.currentRound,
            steps: bubble.liveTrace.steps,
          },
        }
      : {}),
    ...(bubble.executionState ? { executionState: bubble.executionState } : {}),
    ...(bubble.turnPlan ? { turnPlan: bubble.turnPlan } : {}),
  }));
  const pending = session.pendingRequiresAction;
  if (pending?.length) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]?.role === "assistant") {
        out[i] = { ...out[i], requiresAction: pending };
        break;
      }
    }
  }
  if (session.turnPlan) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]?.role === "assistant") {
        if (!out[i].turnPlan) {
          out[i] = { ...out[i], turnPlan: session.turnPlan };
        }
        break;
      }
    }
  }
  return out;
}

/**
 * 将一条「助手」消息追加到会话的 conversationHistory（不经模型生成）。
 * 用于委派完成/失败后回传到律师主对话，供下一轮 runTurn 与桌面轮询 UI 消费。
 */
export function appendSyntheticAssistantReply(
  workspaceDir: string,
  sessionId: string,
  content: string,
): void {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return;
  }
  const text = content.trim();
  if (!text) {
    return;
  }
  session.conversationHistory.push({
    role: "assistant",
    content: text,
    timestamp: new Date().toISOString(),
  });
  saveSession(workspaceDir, session);
}

/**
 * 回合开始的占位记录就是靠这里写的；收尾时用同一 turnId 覆盖，
 * 保证「一轮只留一条」，也保证中断能被读出来。
 */
export function upsertSessionTurn(session: AgentSession, turn: AgentTurn): void {
  const index = session.turns.findIndex((t) => t.turnId === turn.turnId);
  if (index >= 0) {
    session.turns[index] = turn;
    return;
  }
  session.turns.push(turn);
}

/**
 * 追加一个完整的 turn 到 JSONL 文件（用于全量审计和回放）
 */
export function appendTurn(workspaceDir: string, turn: AgentTurn): void {
  persistOrThrow("turns", () => {
    const dir = sessionsDir(workspaceDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = turnsFilePath(workspaceDir, turn.sessionId);
    fs.appendFileSync(filePath, JSON.stringify(turn) + "\n", "utf8");
  });
}

/**
 * 读取 session 的全部 turn 记录
 */
export function loadTurns(workspaceDir: string, sessionId: string): AgentTurn[] {
  const filePath = turnsFilePath(workspaceDir, sessionId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentTurn);
  } catch {
    return [];
  }
}

/**
 * 列出所有 session，按 updatedAt 倒序
 */
/** listSessions 的逐文件 (mtime,size) 缓存：长会话目录下不再每次全量重读+解析。 */
const listSessionsFileCache = new Map<
  string,
  { mtimeMs: number; size: number; session: AgentSession }
>();

export function listSessions(workspaceDir: string): AgentSession[] {
  const dir = sessionsDir(workspaceDir);
  try {
    const files = fs
      .readdirSync(dir)
      .filter(
        (f) => f.endsWith(".json") && !f.endsWith(".turns.jsonl") && !f.endsWith(".desk.json"),
      );
    return files
      .map((file) => {
        const full = path.join(dir, file);
        try {
          const stat = fs.statSync(full);
          const cached = listSessionsFileCache.get(full);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.session;
          }
          const session = JSON.parse(fs.readFileSync(full, "utf8")) as AgentSession;
          // 防御性上限：大量历史会话时只保留最近一批（LRU 近似——Map 插入序）。
          if (listSessionsFileCache.size > 512) {
            const oldest = listSessionsFileCache.keys().next().value;
            if (oldest) {
              listSessionsFileCache.delete(oldest);
            }
          }
          listSessionsFileCache.set(full, { mtimeMs: stat.mtimeMs, size: stat.size, session });
          return session;
        } catch {
          return null;
        }
      })
      .filter((session): session is AgentSession => session !== null)
      .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

/** 在办目录用。优先读 saveSession 写下的小索引；没有索引时才读完整会话并补上。不要把结果交给 saveSession。 */
const listSessionsDeskCache = new Map<
  string,
  { mtimeMs: number; size: number; session: AgentSession }
>();

function readDeskCache(filePath: string, stat: fs.Stats): AgentSession | null {
  const cached = listSessionsDeskCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.session;
  }
  return null;
}

function rememberDesk(filePath: string, stat: fs.Stats, session: AgentSession): void {
  if (listSessionsDeskCache.size > 512) {
    const oldest = listSessionsDeskCache.keys().next().value;
    if (oldest) {
      listSessionsDeskCache.delete(oldest);
    }
  }
  listSessionsDeskCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, session });
}

export function listSessionsForDesk(workspaceDir: string): AgentSession[] {
  const dir = sessionsDir(workspaceDir);
  try {
    const names = fs.readdirSync(dir);
    const deskNames = new Set(names.filter((name) => name.endsWith(".desk.json")));
    const byId = new Map<string, AgentSession>();
    for (const name of names) {
      if (!name.endsWith(".desk.json")) {
        continue;
      }
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        const cached = readDeskCache(full, stat);
        const session = cached ?? (JSON.parse(fs.readFileSync(full, "utf8")) as AgentSession);
        if (!session?.sessionId) {
          continue;
        }
        if (!cached) {
          rememberDesk(full, stat, session);
        }
        byId.set(session.sessionId, session);
      } catch {
        /* 坏索引下面用完整会话重建 */
      }
    }
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".turns.jsonl") || name.endsWith(".desk.json")) {
        continue;
      }
      const sessionId = name.slice(0, -".json".length);
      if (deskNames.has(`${sessionId}.desk.json`)) {
        continue;
      }
      const jsonPath = path.join(dir, name);
      const deskPath = path.join(dir, `${sessionId}.desk.json`);
      try {
        const full = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as AgentSession;
        if (!full?.sessionId) {
          continue;
        }
        const slim = slimSessionForDesk(full);
        try {
          writeSessionDeskSnapshot(workspaceDir, full);
        } catch {
          /* 下次再补 */
        }
        byId.set(full.sessionId, slim);
        try {
          rememberDesk(deskPath, fs.statSync(deskPath), slim);
        } catch {
          /* 索引没写上时，这一轮仍用内存里的瘦副本 */
        }
      } catch {
        /* 坏文件跳过 */
      }
    }
    return [...byId.values()].toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    return [];
  }
}

/**
 * 压缩对话历史：当消息数超过上限时，保留 system + 最近若干条。
 * 切点按 tool 调用整组对齐，避免保留段以孤立 tool 结果开头。
 */
export function compactHistory(
  messages: AgentMessage[],
  maxMessages: number = MAX_HISTORY_DEFAULT,
): AgentMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const systemMessages = messages.filter((msg) => msg.role === "system");
  const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

  const keepCount = maxMessages - systemMessages.length;
  if (keepCount <= 0) {
    return systemMessages;
  }
  const { kept } = sliceKeepingToolGroups(nonSystemMessages, keepCount);
  const merged = [...systemMessages, ...kept];
  const normalized = normalizeToolResultMessages(merged);
  return normalized.changed ? normalized.messages : merged;
}

export type ModelChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Passed back when this assistant turn used tools. Not lawyer-visible. */
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

/**
 * Sole session → LLM history mapper for runTurn.
 * Callers must write `conversationHistory` first (prompt / compact / tools), then derive.
 *
 * 送出前的最后一道配对修复，并写回 session（随下一次 saveSession 落盘）：
 *   - 孤立 tool 结果：调用还在就挪回去，调用已被压缩丢掉就删除（DeepSeek 400）。
 *   - 悬空 tool_call：补「未完成，从这里接着」，避免缺结果的 tool_calls 整请求 400，
 *     也不要把中断的步骤写成已取消。
 *   - 一条 tool 消息里的多个结果：展开成每个 tool_call_id 一条 wire 消息（不改落盘行数）。
 *
 * Remaining-token notes are sample-time only — use {@link deriveModelMessagesForSampling}.
 */
export function deriveModelMessages(session: AgentSession): ModelChatMessage[] {
  const rewritten = rewriteUnfinishedToolPlaceholders(session.conversationHistory);
  const normalized = normalizeToolResultMessages(rewritten.messages);
  const pairing = repairToolCallPairing(normalized.messages);
  if (rewritten.changed || normalized.changed || pairing.repairedToolCallIds.length > 0) {
    session.conversationHistory = pairing.messages;
  }
  const source =
    rewritten.changed || normalized.changed || pairing.repairedToolCallIds.length > 0
      ? pairing.messages
      : session.conversationHistory;
  return projectHistoryToModelMessages(source);
}

/**
 * One persisted tool row may carry several responses. OpenAI-compatible
 * APIs (and Codex) require one wire `tool` message per `tool_call_id`;
 * dropping every response after the first makes later calls look unanswered.
 */
function projectHistoryToModelMessages(source: AgentMessage[]): ModelChatMessage[] {
  const out: ModelChatMessage[] = [];
  for (const msg of source) {
    const responses = msg.toolCallResponses ?? [];
    if (msg.role === "tool" && responses.length > 1) {
      for (const resp of responses) {
        out.push({
          role: "tool",
          content: JSON.stringify(resp.result),
          tool_call_id: resp.toolCallId,
        });
      }
      continue;
    }

    const base: ModelChatMessage = {
      role: msg.role,
      content: msg.content,
      ...(msg.reasoningContent ? { reasoning_content: msg.reasoningContent } : {}),
    };

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      base.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }

    if (responses.length > 0) {
      base.tool_call_id = responses[0].toolCallId;
      base.content = JSON.stringify(responses[0].result);
    }

    out.push(base);
  }
  return out;
}

/** Alias kept for existing imports; same function as {@link deriveModelMessages}. */
export const toModelMessages = deriveModelMessages;

/**
 * Sampling projection: persistent history plus ephemeral turn_context and
 * remaining-token notes. Do not persist those into conversationHistory
 * (keeps prompt cache + derive_len alignment).
 */
export function deriveModelMessagesForSampling(
  session: AgentSession,
  budget?: { used: number; effectiveLimit: number; warnRatio?: number },
): ModelChatMessage[] {
  const readings = renderEngineReadings(session.factorState);
  const tail = [session.samplingPromptTail?.trim(), readings].filter(Boolean).join("\n\n");
  let messages = withEphemeralTurnContext(
    projectSamplingAssistantProse(
      projectSamplingToolResults(deriveModelMessages(session)),
      session.factorState,
    ),
    tail || undefined,
  );
  if (
    budget &&
    shouldInjectRemainingTokensNote(budget.used, budget.effectiveLimit, budget.warnRatio)
  ) {
    messages = withEphemeralBudgetNote(
      messages,
      formatRemainingTokensNote(budget.used, budget.effectiveLimit),
    );
  }
  return messages;
}

/** Sampling view only. Persisted tool rows stay intact for audit and later turns. */
function projectSamplingToolResults(messages: ModelChatMessage[]): ModelChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool" || !message.content) {
      return message;
    }
    const content = projectToolResultForSampling(message.content);
    return content === message.content ? message : { ...message, content };
  });
}

function projectSamplingAssistantProse(
  messages: ModelChatMessage[],
  state: AgentSession["factorState"],
): ModelChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.content) {
      return message;
    }
    const content = projectAssistantProseForSampling(message.content, state);
    return content === message.content ? message : { ...message, content };
  });
}
