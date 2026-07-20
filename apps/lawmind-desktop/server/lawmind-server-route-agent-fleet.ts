/**
 * Agent fleet + preset routes (在办事项).
 */

import { loadSession, displayChatSessionTitle, saveSession } from "../../../src/lawmind/agent/session.js";
import { listWorkspaceAgentPresets } from "../../../src/lawmind/agent/agent-presets.js";
import { loadAssistantProfiles, resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import {
  firstPassRate,
  loadAgentSpecializationStore,
} from "../../../src/lawmind/learning/agent-specialization.js";
import { buildAgentFleetSummary } from "../../../src/lawmind/platform/build-agent-fleet.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { listWorkflowJobs } from "./lawmind-server-jobs.js";

function pendingActionsForSession(
  workspaceDir: string,
  session: NonNullable<ReturnType<typeof loadSession>>,
): NonNullable<typeof session.pendingRequiresAction> {
  const pending = session.pendingRequiresAction ?? [];
  if (pending.length > 0) {
    return pending;
  }
  const last = session.turns[session.turns.length - 1];
  const fromTurn = last?.requiresAction ?? [];
  if (fromTurn.length === 0) {
    return [];
  }
  session.pendingRequiresAction = fromTurn;
  try {
    saveSession(workspaceDir, session);
  } catch {
    /* best-effort */
  }
  return fromTurn;
}
export async function handleAgentFleetRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/agent-fleet" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const matterFilter = matterId && isValidMatterId(matterId) ? matterId : undefined;
    if (matterId && !matterFilter) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }

    const jobs = listWorkflowJobs(40, {
      workspaceDir,
      matterId: matterFilter,
    }).map((job) => ({
      jobId: job.jobId,
      status: job.status,
      matterId: job.matterId,
      templateId: job.templateId,
      workflowId: job.workflowId,
      createdAt: job.createdAt,
      updatedAt: job.completedAt ?? job.startedAt ?? job.createdAt,
      progress: job.progress
        ? {
            totalSteps: job.progress.totalSteps,
            completedSteps: job.progress.completedSteps,
            runningStepIds: job.progress.runningStepIds,
          }
        : undefined,
    }));

    const lawMindRoot = resolveLawMindRoot(workspaceDir, ctx.envFile);
    const assistantLabels = Object.fromEntries(
      loadAssistantProfiles(lawMindRoot).map((a) => [a.assistantId, a.displayName]),
    );

    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      matterId: matterFilter,
      jobs,
      assistantLabels,
    });
    const specializationStore = loadAgentSpecializationStore(workspaceDir);
    const specialization = Object.fromEntries(
      Object.entries(specializationStore.byAssistant).map(([assistantId, stats]) => [
        assistantId,
        { ...stats, firstPassRate: firstPassRate(stats) },
      ]),
    );

    sendJson(res, 200, { ok: true, ...fleet, specialization }, c);
    return true;
  }

  if (pathname === "/api/agent-presets" && req.method === "GET") {
    const presets = listWorkspaceAgentPresets(workspaceDir);
    sendJson(res, 200, { ok: true, presets }, c);
    return true;
  }

  const transcriptMatch = /^\/api\/sessions\/([^/]+)\/fleet-transcript$/.exec(pathname);
  if (transcriptMatch && req.method === "GET") {
    const sessionId = transcriptMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJsonError(res, 404, "not_found", "未找到该会话。", c);
      return true;
    }
    const lastTurn = session.turns[session.turns.length - 1];
    const pendingRequiresAction = pendingActionsForSession(workspaceDir, session);
    const messages = session.conversationHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-24)
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 2000) : "",
      }));
    sendJson(
      res,
      200,
      {
        ok: true,
        sessionId: session.sessionId,
        title: displayChatSessionTitle(session),
        matterId: session.matterId,
        assistantId: session.assistantId,
        updatedAt: session.updatedAt,
        messages,
        executionState: lastTurn?.executionState,
        pendingRequiresAction,
      },
      c,
    );
    return true;
  }

  return false;
}
