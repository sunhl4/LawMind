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
import type { AgentMessage, AgentSession, AgentTurn } from "./types.js";

const SESSIONS_DIR = "sessions";
const MAX_HISTORY_DEFAULT = 40;

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
}): AgentSession {
  const session: AgentSession = {
    sessionId: randomUUID(),
    matterId: opts.matterId,
    actorId: opts.actorId,
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dir = sessionsDir(opts.workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    sessionFilePath(opts.workspaceDir, session.sessionId),
    JSON.stringify(session, null, 2),
    "utf8",
  );

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
  const dir = sessionsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    sessionFilePath(workspaceDir, session.sessionId),
    JSON.stringify(session, null, 2),
    "utf8",
  );
}

/**
 * 追加一个完整的 turn 到 JSONL 文件（用于全量审计和回放）
 */
export function appendTurn(workspaceDir: string, turn: AgentTurn): void {
  const dir = sessionsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = turnsFilePath(workspaceDir, turn.sessionId);
  fs.appendFileSync(filePath, JSON.stringify(turn) + "\n", "utf8");
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
export function listSessions(workspaceDir: string): AgentSession[] {
  const dir = sessionsDir(workspaceDir);
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".turns.jsonl"));
    return files
      .map((file) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as AgentSession;
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

/**
 * 将 session 的 conversationHistory 转换为发送给 LLM 的消息格式
 */
export function toModelMessages(session: AgentSession): Array<{
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}> {
  return session.conversationHistory.map((msg) => {
    const base: {
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    } = {
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
