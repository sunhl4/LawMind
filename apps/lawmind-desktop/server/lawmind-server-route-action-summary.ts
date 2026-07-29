/**
 * Action summary + approval resolve routes.
 */

import { displayChatSessionTitle, listSessions, saveSession } from "../../../src/lawmind/agent/session.js";
import { readCollaborationEventsSince } from "../../../src/lawmind/agent/collaboration/index.js";
import { listPendingToolApprovals } from "../../../src/lawmind/platform/pending-tool-approvals.js";
import type { LawMindRequiresAction } from "../../../src/lawmind/platform/requires-action.js";
import { resolveApproval } from "../../../src/lawmind/application/services/approval-service.js";
import { listApprovalRequests, listWorkQueueItems } from "../../../src/lawmind/application/services/queue-service.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { listOpenAutomationInbox } from "../../../src/lawmind/platform/lawyer-automations.js";
import { readTaskRecord } from "../../../src/lawmind/tasks/index.js";
import { listWorkflowJobs } from "./lawmind-server-jobs.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { approvalResolvePostSchema } from "./lawmind-api-schemas.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

/** Info badges only — must not inflate requiresDecisionTotal (Wave D / T4.4). */
const COLLAB_COMPLETION_WINDOW_MS = 48 * 60 * 60 * 1000;

export type ChatRequiresActionRow = {
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
  actions: LawMindRequiresAction[];
};

/**
 * Prefer session.pendingRequiresAction. If empty but the last turn still has
 * requiresAction (stale clear), rehydrate so /api/chat/resume can find action ids.
 */
function resolveSessionChatActions(
  workspaceDir: string,
  session: ReturnType<typeof listSessions>[number],
): LawMindRequiresAction[] {
  const pending = session.pendingRequiresAction ?? [];
  if (pending.length > 0) {
    return pending.map((a) => ({
      ...a,
      sessionId: a.sessionId ?? session.sessionId,
    }));
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
    /* best-effort rehydrate */
  }
  return fromTurn.map((a) => ({
    ...a,
    sessionId: a.sessionId ?? session.sessionId,
  }));
}

function listChatRequiresActions(
  workspaceDir: string,
  matterFilter?: string,
): ChatRequiresActionRow[] {
  const rows: ChatRequiresActionRow[] = [];
  for (const s of listSessions(workspaceDir)) {
    if (matterFilter && s.matterId !== matterFilter) {
      continue;
    }
    const actions = resolveSessionChatActions(workspaceDir, s);
    if (actions.length === 0) {
      continue;
    }
    rows.push({
      sessionId: s.sessionId,
      title: displayChatSessionTitle(s),
      matterId: s.matterId,
      assistantId: s.assistantId,
      actions,
    });
  }
  return rows;
}

function countChatRequiresActions(rows: ChatRequiresActionRow[]): number {
  return rows.reduce((n, row) => n + row.actions.length, 0);
}

export async function handleActionSummaryRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/action-summary" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const matterFilter = matterId && isValidMatterId(matterId) ? matterId : undefined;
    if (matterId && !matterFilter) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }

    const [pendingApprovals, openQueueItems, jobs] = await Promise.all([
      listApprovalRequests(workspaceDir, { matterId: matterFilter, status: "pending" }),
      listWorkQueueItems(workspaceDir, { matterId: matterFilter, status: "open" }),
      Promise.resolve(
        listWorkflowJobs(30, {
          workspaceDir,
          status: ["queued", "running"],
        }),
      ),
    ]);

    const toolApprovals = listPendingToolApprovals(workspaceDir, {
      matterId: matterFilter,
    });
    const chatRequiresActions = listChatRequiresActions(workspaceDir, matterFilter);
    const chatRequiresActionCount = countChatRequiresActions(chatRequiresActions);
    const pendingReviewDrafts = listDrafts(workspaceDir).filter(
      (draft) =>
        (!matterFilter || draft.matterId === matterFilter) &&
        (draft.reviewStatus === "pending" || draft.reviewStatus === "modified"),
    );
    const automationInbox = listOpenAutomationInbox(workspaceDir, matterFilter);
    const requiresDecisionTotal =
      pendingApprovals.length +
      openQueueItems.length +
      chatRequiresActionCount +
      pendingReviewDrafts.length +
      automationInbox.length;
    const total =
      requiresDecisionTotal +
      jobs.length;

    const sinceIso = new Date(Date.now() - COLLAB_COMPLETION_WINDOW_MS).toISOString();
    const recentCollab = readCollaborationEventsSince(workspaceDir, sinceIso).filter((ev) => {
      if (matterFilter && ev.matterId !== matterFilter) {
        return false;
      }
      return ev.kind === "review.completed" || ev.kind === "delegation.completed";
    });
    const recentReviewCompleted = recentCollab.filter((ev) => ev.kind === "review.completed").length;
    const recentDelegationCompleted = recentCollab.filter(
      (ev) => ev.kind === "delegation.completed",
    ).length;

    sendJson(
      res,
      200,
      {
        ok: true,
        total,
        pendingApprovals: pendingApprovals.length,
        openQueueItems: openQueueItems.length,
        activeJobs: jobs.length,
        requiresDecisionTotal,
        pendingReviewCount: pendingReviewDrafts.length,
        chatRequiresActionCount,
        pendingToolApprovals: toolApprovals.length,
        pendingAutomationCount: automationInbox.length,
        /** 近 48h 协作完成（信息角标，不计入待我拍板） */
        recentReviewCompleted,
        recentDelegationCompleted,
        recentCollabCompleted: recentReviewCompleted + recentDelegationCompleted,
        approvals: pendingApprovals.slice(0, 20),
        queueItems: openQueueItems.slice(0, 20),
        jobs: jobs.slice(0, 10),
        pendingReviewDrafts: pendingReviewDrafts.slice(0, 20).map((draft) => {
          const task = readTaskRecord(workspaceDir, draft.taskId);
          return {
            taskId: draft.taskId,
            matterId: draft.matterId,
            title: draft.title,
            reviewStatus: draft.reviewStatus,
            createdAt: draft.createdAt,
            assistantId: task?.assistantId,
          };
        }),
        toolApprovals: toolApprovals.slice(0, 20),
        chatRequiresActions: chatRequiresActions.slice(0, 30),
        automationInbox: automationInbox.slice(0, 30),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/approvals/resolve" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, approvalResolvePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        const issues = err.issues.join(" ");
        if (issues.includes("status")) {
          sendJsonError(
            res,
            400,
            "invalid_status",
            "status 须为 approved、rejected 或 needs_changes。",
            c,
          );
          return true;
        }
        sendJsonError(res, 400, "invalid_fields", "缺少有效的 matterId 或 approvalId。", c);
        return true;
      }
      throw err;
    }
    const matterId = body.matterId;
    const approvalId = body.approvalId;
    const statusRaw = body.status;
    if (!isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_fields", "缺少有效的 matterId 或 approvalId。", c);
      return true;
    }
    const resolvedBy =
      typeof body.resolvedBy === "string" && body.resolvedBy.trim()
        ? body.resolvedBy.trim()
        : resolveDesktopActorId();
    const result = resolveApproval(workspaceDir, matterId, approvalId, {
      status: statusRaw,
      resolvedBy,
    });
    if (result.outcome === "not_found") {
      sendJsonError(res, 404, "approval_not_found", "未找到该审批项。", c);
      return true;
    }
    if (result.outcome === "already_resolved") {
      sendJsonError(
        res,
        409,
        "approval_already_resolved",
        "该审批已被处理，当前状态未变更。",
        c,
        { approval: result.approval },
      );
      return true;
    }
    sendJson(res, 200, { ok: true, approval: result.approval }, c);
    return true;
  }

  return false;
}
