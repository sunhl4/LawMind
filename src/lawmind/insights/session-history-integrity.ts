/**
 * 会话历史完整性：工具调用配对的双向检查与修复。
 *
 * 两类损坏都会让 OpenAI 兼容接口（DeepSeek 尤其严格）整请求 400，
 * 且坏历史一旦落盘，每一轮都会重放同样的错误：
 *   - dangling：assistant(tool_calls) 缺 tool 结果 —— 中断/异常路径残留。
 *   - orphan：tool 结果缺对应调用 —— 压缩把 assistant 整条丢掉（客户实际遇到的）。
 *
 * 这里只做「观测 + 显式修复」。送出侧由 deriveModelMessages（session 路径）
 * 与 sanitizeWireMessages（wire 层）兜底，二者不受本模块影响。
 */

import { repairTranscriptFile } from "../adapters/session-transcript/index.js";
import {
  findOrphanToolResultIds,
  findUnpairedToolCallIds,
  normalizeToolResultMessages,
  repairToolCallPairing,
} from "../agent/session-tool-call-pairing.js";
import { listSessions, saveSession } from "../agent/session.js";
import type { AgentSession } from "../agent/types.js";

/** 扫描上限：健康面板每次请求都会调用，避免大工作区拖慢 /api/health。 */
export const SESSION_INTEGRITY_SCAN_LIMIT = 40;

export type SessionHistoryIntegrityIssue = {
  sessionId: string;
  title?: string;
  danglingToolCallIds: string[];
  orphanToolResultIds: string[];
};

export type SessionHistoryIntegrityReport = {
  ok: boolean;
  scannedSessions: number;
  corruptSessionCount: number;
  danglingToolCallCount: number;
  orphanToolResultCount: number;
  issues: SessionHistoryIntegrityIssue[];
};

function inspectSession(session: AgentSession): SessionHistoryIntegrityIssue | undefined {
  const history = session.conversationHistory ?? [];
  const danglingToolCallIds = findUnpairedToolCallIds(history);
  const orphanToolResultIds = findOrphanToolResultIds(history);
  if (danglingToolCallIds.length === 0 && orphanToolResultIds.length === 0) {
    return undefined;
  }
  return {
    sessionId: session.sessionId,
    title: session.title,
    danglingToolCallIds,
    orphanToolResultIds,
  };
}

export function scanSessionHistoryIntegrity(
  workspaceDir: string,
  opts?: { maxSessions?: number },
): SessionHistoryIntegrityReport {
  const limit = Math.max(1, opts?.maxSessions ?? SESSION_INTEGRITY_SCAN_LIMIT);
  const sessions = listSessions(workspaceDir).slice(0, limit);
  const issues: SessionHistoryIntegrityIssue[] = [];
  let danglingToolCallCount = 0;
  let orphanToolResultCount = 0;
  for (const session of sessions) {
    const issue = inspectSession(session);
    if (!issue) {
      continue;
    }
    danglingToolCallCount += issue.danglingToolCallIds.length;
    orphanToolResultCount += issue.orphanToolResultIds.length;
    issues.push(issue);
  }
  return {
    ok: issues.length === 0,
    scannedSessions: sessions.length,
    corruptSessionCount: issues.length,
    danglingToolCallCount,
    orphanToolResultCount,
    issues: issues.slice(0, 8),
  };
}

export type SessionHistoryRepairResult = {
  scannedSessions: number;
  repairedSessionIds: string[];
  repairedTranscriptIds: string[];
};

/**
 * 显式修复（`pnpm lawmind:doctor --fix`）：把每个损坏会话的 session.json 与
 * transcript.jsonl 就地改成可送出的形状。改写前先做原样比较，无改动不落盘。
 */
export function repairSessionHistoryIntegrity(workspaceDir: string): SessionHistoryRepairResult {
  const sessions = listSessions(workspaceDir);
  const repairedSessionIds: string[] = [];
  const repairedTranscriptIds: string[] = [];

  for (const session of sessions) {
    const issue = inspectSession(session);
    if (issue) {
      const normalized = normalizeToolResultMessages(session.conversationHistory ?? []);
      const pairing = repairToolCallPairing(normalized.messages);
      session.conversationHistory = pairing.messages;
      saveSession(workspaceDir, session);
      repairedSessionIds.push(session.sessionId);
    }
    const transcriptOpts = session.collaborationDelegationId
      ? { delegationId: session.collaborationDelegationId }
      : undefined;
    if (repairTranscriptFile(workspaceDir, session.sessionId, transcriptOpts)) {
      repairedTranscriptIds.push(session.sessionId);
    }
  }

  return {
    scannedSessions: sessions.length,
    repairedSessionIds,
    repairedTranscriptIds,
  };
}
