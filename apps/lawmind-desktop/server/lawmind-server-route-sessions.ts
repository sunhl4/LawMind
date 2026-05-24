import {
  loadSession,
  saveSession,
  sessionHistoryToSimpleMessages,
} from "../../../src/lawmind/agent/session.js";
import { autoCompactSessionHistory } from "../../../src/lawmind/agent/compact.js";
import { estimateTokenBudget } from "../../../src/lawmind/agent/context-budget.js";
import { loadTranscriptForResume, repairTranscriptChain } from "../../../src/lawmind/adapters/session-transcript/index.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import { listPendingToolApprovals } from "../../../src/lawmind/platform/pending-tool-approvals.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handleSessionExtendedRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  const budgetMatch = /^\/api\/sessions\/([^/]+)\/context-budget$/.exec(pathname);
  if (budgetMatch && req.method === "GET") {
    const sessionId = budgetMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const policy = readWorkspacePolicyFile(workspaceDir);
    const budget = estimateTokenBudget(session, policy);
    sendJson(res, 200, { ok: true, ...budget }, c);
    return true;
  }

  const compactMatch = /^\/api\/sessions\/([^/]+)\/compact$/.exec(pathname);
  if (compactMatch && req.method === "POST") {
    const sessionId = compactMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const policy = readWorkspacePolicyFile(workspaceDir);
    const result = autoCompactSessionHistory(session, workspaceDir, {
      maxHistoryMessages: 50,
      policy,
    });
    session.conversationHistory = result.messages;
    saveSession(workspaceDir, session);
    sendJson(
      res,
      200,
      {
        ok: true,
        compacted: result.compacted,
        sessionSummaryPath: result.sessionSummaryPath,
        droppedMessageCount: result.droppedMessageCount,
      },
      c,
    );
    return true;
  }

  const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(pathname);
  if (resumeMatch && req.method === "POST") {
    const sessionId = resumeMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const transcript = loadTranscriptForResume(workspaceDir, sessionId);
    if (transcript.length > 0) {
      const system = session.conversationHistory.filter((m) => m.role === "system").slice(0, 1);
      session.conversationHistory = [...system, ...repairTranscriptChain(transcript)];
      saveSession(workspaceDir, session);
    }
    const pendingApprovals = listPendingToolApprovals(workspaceDir, {
      matterId: session.matterId,
    }).filter((p) => p.sessionId === sessionId);
    sendJson(
      res,
      200,
      {
        ok: true,
        sessionId,
        messages: sessionHistoryToSimpleMessages(session),
        pendingApprovals: pendingApprovals.length,
      },
      c,
    );
    return true;
  }

  return false;
}
