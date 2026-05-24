import fs from "node:fs";
import path from "node:path";
import type { AgentSession, AgentTurn } from "../agent/types.js";

const DEFAULT_MIN_MESSAGES = 4;
const DEFAULT_MIN_CHARS = 3_500;
const MIN_TURNS_SINCE_LAST_SUMMARY = 1;

export function sessionSummaryFilePath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "session-summary.md");
}

export function appendSessionSummary(
  workspaceDir: string,
  matterId: string,
  markdownChunk: string,
): { ok: true } | { ok: false; error: string } {
  const id = matterId.trim();
  if (!id) {
    return { ok: false, error: "matter_id_required" };
  }
  const fp = sessionSummaryFilePath(workspaceDir, id);
  const dir = path.dirname(fp);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const block = `\n\n## ${new Date().toISOString()}\n\n${markdownChunk.trim()}\n`;
    if (fs.existsSync(fp)) {
      fs.appendFileSync(fp, block, "utf8");
    } else {
      fs.writeFileSync(fp, `# 会话摘要\n${block}`, "utf8");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Only this path may be written by session-summary subagent tools. */
export function isAllowedSessionSummaryWrite(
  workspaceDir: string,
  matterId: string,
  candidatePath: string,
): boolean {
  const allowed = path.resolve(sessionSummaryFilePath(workspaceDir, matterId));
  const abs = path.resolve(candidatePath);
  return abs === allowed;
}

function conversationCharCount(session: AgentSession): number {
  let n = 0;
  for (const msg of session.conversationHistory) {
    if (msg.role === "system") {
      continue;
    }
    n += (msg.content ?? "").length;
  }
  return n;
}

function nonSystemMessageCount(session: AgentSession): number {
  return session.conversationHistory.filter((m) => m.role !== "system").length;
}

export function shouldExtractSessionSummary(
  session: AgentSession,
  opts?: { minMessages?: number; minChars?: number },
): boolean {
  if (!session.matterId?.trim()) {
    return false;
  }
  const minMessages = opts?.minMessages ?? DEFAULT_MIN_MESSAGES;
  const minChars = opts?.minChars ?? DEFAULT_MIN_CHARS;
  if (nonSystemMessageCount(session) < minMessages) {
    return false;
  }
  if (conversationCharCount(session) < minChars) {
    return false;
  }
  const turnCount = session.turns.length;
  const last = session.lastSessionSummaryTurnCount ?? 0;
  if (turnCount - last < MIN_TURNS_SINCE_LAST_SUMMARY) {
    return false;
  }
  return true;
}

export function buildSessionSummaryChunkFromTurn(turn: AgentTurn, session: AgentSession): string {
  const lines: string[] = [];
  lines.push(`**用户**：${turn.instruction.trim().slice(0, 800)}`);
  const reply =
    typeof turn.result === "string" && turn.result.trim()
      ? turn.result.trim()
      : session.conversationHistory
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .join("\n")
          .trim()
          .slice(-1200);
  if (reply) {
    lines.push(`**助手**：${reply.slice(0, 1200)}`);
  }
  if (turn.toolCallsExecuted > 0) {
    lines.push(`- 工具调用：${turn.toolCallsExecuted} 次`);
  }
  if (turn.status === "awaiting_clarification") {
    lines.push("- 状态：待律师澄清");
  }
  if (turn.status === "awaiting_approval") {
    lines.push("- 状态：待工具批准");
  }
  return lines.join("\n");
}

export function maybeAutoAppendSessionSummary(
  workspaceDir: string,
  session: AgentSession,
  turn: AgentTurn,
): void {
  if (turn.status === "error" || !session.matterId?.trim()) {
    return;
  }
  if (!shouldExtractSessionSummary(session)) {
    return;
  }
  const chunk = buildSessionSummaryChunkFromTurn(turn, session);
  const out = appendSessionSummary(workspaceDir, session.matterId.trim(), chunk);
  if (out.ok) {
    session.lastSessionSummaryTurnCount = session.turns.length;
  }
}
