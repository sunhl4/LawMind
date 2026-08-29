import fs from "node:fs";
import path from "node:path";
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

export function appendTranscriptLines(
  workspaceDir: string,
  sessionId: string,
  messages: AgentMessage[],
  opts?: AppendTranscriptOpts,
): void {
  const fp = resolveTranscriptFile(workspaceDir, sessionId, opts);
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  const lines = messages.filter(isTranscriptMessage).map((msg) => {
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
  });
  if (lines.length === 0) {
    return;
  }
  fs.appendFileSync(fp, `${lines.join("\n")}\n`, "utf8");
}

export function loadTranscriptForResume(workspaceDir: string, sessionId: string): AgentMessage[] {
  const fp = transcriptPath(workspaceDir, sessionId);
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const messages: AgentMessage[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      const parsed = JSON.parse(t) as TranscriptLine;
      messages.push({
        role: parsed.kind,
        content: parsed.content,
        timestamp: parsed.timestamp,
        toolCalls: parsed.toolCalls,
        toolCallResponses: parsed.toolCallResponses,
      });
    }
    return repairTranscriptChain(messages);
  } catch {
    return [];
  }
}

/** Minimal repair: drop orphan tool rows without preceding assistant tool_calls. */
export function repairTranscriptChain(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  let lastHadToolCalls = false;
  for (const msg of messages) {
    if (msg.role === "tool") {
      if (!lastHadToolCalls) {
        continue;
      }
      out.push(msg);
      continue;
    }
    out.push(msg);
    lastHadToolCalls = msg.role === "assistant" && (msg.toolCalls?.length ?? 0) > 0;
  }
  return out;
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
