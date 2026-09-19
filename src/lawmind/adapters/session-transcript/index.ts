import fs from "node:fs";
import path from "node:path";
import {
  normalizeToolResultMessages,
  repairToolCallPairing,
} from "../../agent/session-tool-call-pairing.js";
import type { AgentMessage, AgentSession } from "../../agent/types.js";

const SESSIONS_DIR = "sessions";

export type TranscriptLine = {
  kind: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  toolCalls?: AgentMessage["toolCalls"];
  toolCallResponses?: AgentMessage["toolCallResponses"];
};

function sessionsDir(workspaceDir: string): string {
  return path.join(workspaceDir, SESSIONS_DIR);
}

export function transcriptPath(workspaceDir: string, sessionId: string): string {
  return path.join(sessionsDir(workspaceDir), `${sessionId}.transcript.jsonl`);
}

/** Collaboration delegate sub-sessions: isolated audit trail per delegation. */
export function delegationTranscriptPath(workspaceDir: string, delegationId: string): string {
  return path.join(sessionsDir(workspaceDir), "delegations", `${delegationId}.transcript.jsonl`);
}

export type AppendTranscriptOpts = {
  delegationId?: string;
};

function resolveTranscriptFile(
  workspaceDir: string,
  sessionId: string,
  opts?: AppendTranscriptOpts,
): string {
  const delegationId = opts?.delegationId?.trim();
  if (delegationId) {
    return delegationTranscriptPath(workspaceDir, delegationId);
  }
  return transcriptPath(workspaceDir, sessionId);
}

export function isTranscriptMessage(msg: AgentMessage): boolean {
  return msg.role === "user" || msg.role === "assistant" || msg.role === "tool";
}

/** 解析 transcript JSONL；单行损坏只跳过该行。 */
function parseTranscriptLines(raw: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const parsed = JSON.parse(t) as TranscriptLine;
      messages.push({
        role: parsed.kind,
        content: parsed.content,
        timestamp: parsed.timestamp,
        toolCalls: parsed.toolCalls,
        toolCallResponses: parsed.toolCallResponses,
      });
    } catch {
      /* skip malformed row */
    }
  }
  return messages;
}

function serializeTranscriptLine(msg: AgentMessage): string {
  const line: TranscriptLine = {
    kind: msg.role as TranscriptLine["kind"],
    content: msg.content,
    timestamp: msg.timestamp,
  };
  if (msg.toolCalls?.length) {
    line.toolCalls = msg.toolCalls;
  }
  if (msg.toolCallResponses?.length) {
    line.toolCallResponses = msg.toolCallResponses;
  }
  return JSON.stringify(line);
}

export function appendTranscriptLines(
  workspaceDir: string,
  sessionId: string,
  messages: AgentMessage[],
  opts?: AppendTranscriptOpts,
): void {
  const fp = resolveTranscriptFile(workspaceDir, sessionId, opts);
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  const lines = messages.filter(isTranscriptMessage).map(serializeTranscriptLine);
  if (lines.length === 0) {
    return;
  }
  fs.appendFileSync(fp, `${lines.join("\n")}\n`, "utf8");
}

export function loadTranscriptForResume(workspaceDir: string, sessionId: string): AgentMessage[] {
  const fp = transcriptPath(workspaceDir, sessionId);
  try {
    return repairTranscriptChain(parseTranscriptLines(fs.readFileSync(fp, "utf8")));
  } catch {
    return [];
  }
}

/**
 * 让 transcript 可送出：丢掉孤儿结果，并为缺结果的调用补占位。
 * 两个方向都要修 —— 只丢孤儿的话，悬空 tool_call 在 --resume 时同样 400。
 */
export function repairTranscriptChain(messages: AgentMessage[]): AgentMessage[] {
  const normalized = normalizeToolResultMessages(messages);
  return repairToolCallPairing(normalized.messages).messages;
}

/**
 * `doctor --fix`：把 transcript 就地重写为可送出的形状（原子写）。
 * 返回是否发生了改动。
 */
export function repairTranscriptFile(
  workspaceDir: string,
  sessionId: string,
  opts?: AppendTranscriptOpts,
): boolean {
  const fp = resolveTranscriptFile(workspaceDir, sessionId, opts);
  try {
    if (!fs.existsSync(fp)) {
      return false;
    }
    const messages = parseTranscriptLines(fs.readFileSync(fp, "utf8"));
    if (messages.length === 0) {
      return false;
    }
    const repaired = repairTranscriptChain(messages);
    if (JSON.stringify(repaired) === JSON.stringify(messages)) {
      return false;
    }
    const tmp = `${fp}.repair.tmp`;
    fs.writeFileSync(
      tmp,
      `${repaired.filter(isTranscriptMessage).map(serializeTranscriptLine).join("\n")}\n`,
      "utf8",
    );
    fs.renameSync(tmp, fp);
    return true;
  } catch {
    return false;
  }
}

export function syncTranscriptFromSession(workspaceDir: string, session: AgentSession): void {
  const opts = session.collaborationDelegationId
    ? { delegationId: session.collaborationDelegationId }
    : undefined;
  const fp = resolveTranscriptFile(workspaceDir, session.sessionId, opts);
  if (fs.existsSync(fp)) {
    return;
  }
  appendTranscriptLines(workspaceDir, session.sessionId, session.conversationHistory, opts);
}
