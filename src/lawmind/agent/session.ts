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
import { persistOrThrow } from "./session-persist.js";
import { repairToolCallPairing } from "./session-tool-call-pairing.js";
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
    return JSON.parse(raw) as AgentSession;
  } catch {
    return undefined;
  }
}

export function saveSession(workspaceDir: string, session: AgentSession): void {
  session.updatedAt = new Date().toISOString();
  // 原子写（temp+rename）：崩溃不留半写 session.json。
  // 保持同步语义：resume/级联等调用方依赖「返回即落盘」。失败必须抛出，禁止继续采样。
  persistOrThrow("session", () => {
    writeJsonAtomic(sessionFilePath(workspaceDir, session.sessionId), session);
    const last = session.conversationHistory[session.conversationHistory.length - 1];
    if (last) {
      const transcriptOpts = session.collaborationDelegationId
        ? { delegationId: session.collaborationDelegationId }
        : undefined;
      appendTranscriptLines(workspaceDir, session.sessionId, [last], transcriptOpts);
    }
  });
}

/** 删除会话磁盘文件（json / turns / transcript / events / pending sidecars / spills）。至少删掉一个文件则返回 true。 */
export function deleteSession(workspaceDir: string, sessionId: string): boolean {
  const jsonPath = sessionFilePath(workspaceDir, sessionId);
  const turnsPath = turnsFilePath(workspaceDir, sessionId);
  const transcript = path.join(sessionsDir(workspaceDir), `${sessionId}.transcript.jsonl`);
  const eventsPath = path.join(sessionsDir(workspaceDir), `${sessionId}.events.jsonl`);
  const pendingPins = path.join(sessionsDir(workspaceDir), `${sessionId}.pending-pins.json`);
  const pendingSteer = path.join(sessionsDir(workspaceDir), `${sessionId}.pending-steer.json`);
  const spillsDir = path.join(sessionsDir(workspaceDir), `${sessionId}.spills`);
  try {
    let did = false;
    for (const p of [jsonPath, turnsPath, transcript, eventsPath, pendingPins, pendingSteer]) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        did = true;
      }
    }
    if (fs.existsSync(spillsDir)) {
      fs.rmSync(spillsDir, { recursive: true, force: true });
      did = true;
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

/** 将持久化历史映射为桌面气泡（仅 user / assistant 正文） */
export function sessionHistoryToSimpleMessages(session: AgentSession): Array<{
  role: "user" | "assistant";
  text: string;
  liveTrace?: { active: boolean; currentRound?: number; steps: PersistedChatLiveTrace["steps"] };
  executionState?: AgentMessage["executionState"];
  requiresAction?: AgentTurn["requiresAction"];
}> {
  const out: Array<{
    role: "user" | "assistant";
    text: string;
    liveTrace?: { active: boolean; currentRound?: number; steps: PersistedChatLiveTrace["steps"] };
    executionState?: AgentMessage["executionState"];
    requiresAction?: AgentTurn["requiresAction"];
  }> = [];
  for (const msg of session.conversationHistory) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const text = (msg.content ?? "").trim();
    if (!text && !msg.liveTrace?.steps?.length) {
      continue;
    }
    out.push({
      role: msg.role,
      text,
      ...(msg.liveTrace
        ? {
            liveTrace: {
              active: false,
              currentRound: msg.liveTrace.currentRound,
              steps: msg.liveTrace.steps,
            },
          }
        : {}),
      ...(msg.executionState ? { executionState: msg.executionState } : {}),
    });
  }
  const pending = session.pendingRequiresAction;
  if (pending?.length) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]?.role === "assistant") {
        out[i] = { ...out[i], requiresAction: pending };
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
      .filter((f) => f.endsWith(".json") && !f.endsWith(".turns.jsonl"));
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

/**
 * 压缩对话历史：当消息数超过上限时，保留 system + 最近 N 条
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
  const keptMessages = nonSystemMessages.slice(-keepCount);

  return [...systemMessages, ...keptMessages];
}

export type ModelChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
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
 * 送出前的最后一道配对修复：历史中的悬空 tool_call（旧版本中断残留、异常路径）
 * 在此补占位 tool 消息并写回 session（随下一次 saveSession 落盘），保证
 * 「不配对不得送出」——OpenAI 兼容 API 对缺配对的 tool_call 会整体 400。
 */
export function deriveModelMessages(session: AgentSession): ModelChatMessage[] {
  const pairing = repairToolCallPairing(session.conversationHistory);
  if (pairing.repairedToolCallIds.length > 0) {
    session.conversationHistory = pairing.messages;
  }
  return session.conversationHistory.map((msg) => {
    const base: ModelChatMessage = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      base.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }

    if (msg.toolCallResponses && msg.toolCallResponses.length > 0) {
      base.tool_call_id = msg.toolCallResponses[0].toolCallId;
      base.content = JSON.stringify(msg.toolCallResponses[0].result);
    }

    return base;
  });
}

/** Alias kept for existing imports; same function as {@link deriveModelMessages}. */
export const toModelMessages = deriveModelMessages;
