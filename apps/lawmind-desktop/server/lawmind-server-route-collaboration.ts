import {
  cancelDelegation,
  getDelegation,
  listDelegations,
  listWorkspaceWorkflowTemplates,
  readCollaborationEvents,
  readWorkspaceWorkflowTemplate,
  instantiateCollaborationWorkflowFromTemplate,
} from "../../../src/lawmind/agent/collaboration/index.js";
import {
  buildWorkflowReport,
  executeWorkflow as runCollaborationWorkflow,
} from "../../../src/lawmind/agent/orchestrator/index.js";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  buildAgentConfig,
  readJsonBody,
  sendJson,
} from "./lawmind-server-helpers.js";
import { enqueueWorkflowRun } from "./lawmind-server-jobs.js";

export async function handleCollaborationRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/collaboration/summary" && req.method === "GET") {
    const collaborationEnabled =
      process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
    const delegations = listDelegations();
    const events = readCollaborationEvents(workspaceDir).slice(-40);
    sendJson(
      res,
      200,
      {
        ok: true,
        collaborationEnabled,
        collaborationHint: collaborationEnabled
          ? "协作已开启：委派与事件会写入内存注册表与 workspace 审计（若存在）。"
          : "协作已关闭（LAWMIND_ENABLE_COLLABORATION=false）：不会注册多助手委派。",
        delegationCount: delegations.length,
        delegations: delegations.slice(-20).map((delegation) => ({
          delegationId: delegation.delegationId,
          fromAssistantId: delegation.fromAssistantId,
          toAssistantId: delegation.toAssistantId,
          status: delegation.status,
          matterId: delegation.matterId,
          startedAt: delegation.startedAt,
        })),
        recentCollaborationEvents: events,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/delegations" && req.method === "GET") {
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const assistantFilter = url.searchParams.get("assistantId") ?? undefined;
    const records = listDelegations({
      fromAssistantId: assistantFilter || undefined,
      status: statusFilter as "pending" | "running" | "completed" | "failed" | undefined,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        delegations: records.slice(0, 100).map((record) => ({
          delegationId: record.delegationId,
          fromAssistant: record.fromAssistantId,
          toAssistant: record.toAssistantId,
          task: record.task.slice(0, 200),
          status: record.status,
          priority: record.priority,
          result: record.result?.slice(0, 300),
          error: record.error,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
        })),
        total: records.length,
      },
      c,
    );
    return true;
  }

  {
    const delegationDetail = pathname.match(/^\/api\/delegations\/([^/]+)$/);
    if (delegationDetail && req.method === "GET") {
      const id = decodeURIComponent(delegationDetail[1] ?? "");
      const record = getDelegation(id);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, delegation: record }, c);
      return true;
    }
    if (delegationDetail && req.method === "DELETE") {
      const id = decodeURIComponent(delegationDetail[1] ?? "");
      const record = cancelDelegation(workspaceDir, id);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, delegation: record }, c);
      return true;
    }
  }

  if (pathname === "/api/collaboration/workflow-templates" && req.method === "GET") {
    const templates = listWorkspaceWorkflowTemplates(workspaceDir);
    sendJson(res, 200, { ok: true, templates }, c);
    return true;
  }

  if (pathname === "/api/collaboration/workflow-run" && req.method === "POST") {
    const collaborationEnabled =
      process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
    if (!collaborationEnabled) {
      sendJson(
        res,
        503,
        {
          ok: false,
          code: "collaboration_disabled",
          message: "多助手协作已关闭（LAWMIND_ENABLE_COLLABORATION=false），无法运行团队工作流。",
        },
        c,
      );
      return true;
    }
    const body = (await readJsonBody(req)) as {
      templateId?: string;
      matterId?: string;
      assistantId?: string;
      vars?: Record<string, string>;
      async?: boolean;
      idempotencyKey?: string;
    };
    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!templateId) {
      sendJson(res, 400, { ok: false, error: "templateId_required" }, c);
      return true;
    }
    const matterRaw = typeof body.matterId === "string" ? body.matterId.trim() : "";
    if (matterRaw && !isValidMatterId(matterRaw)) {
      sendJson(res, 400, { ok: false, error: "invalid_matter_id" }, c);
      return true;
    }
    const template = readWorkspaceWorkflowTemplate(workspaceDir, templateId);
    if (!template) {
      sendJson(res, 404, { ok: false, error: "template_not_found", templateId }, c);
      return true;
    }
    const built = buildAgentConfig(workspaceDir);
    if (built.error === "missing_api_key" || !built.config) {
      sendJson(
        res,
        503,
        { ok: false, error: "missing_api_key", message: "未配置模型 API，无法执行工作流。" },
        c,
      );
      return true;
    }
    const assistantId = typeof body.assistantId === "string" ? body.assistantId.trim() : "";
    const baseConfig = {
      ...built.config,
      ...(assistantId ? { assistantId, actorId: `assistant:${assistantId}` } : {}),
    };
    const workflow = instantiateCollaborationWorkflowFromTemplate(template, {
      matterId: matterRaw || undefined,
      createdBy: assistantId || baseConfig.assistantId || baseConfig.actorId,
      vars: body.vars && typeof body.vars === "object" ? body.vars : undefined,
    });
    if (body.async === true) {
      const idempotencyKey =
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
      const jobId = enqueueWorkflowRun(baseConfig, workflow, { idempotencyKey });
      sendJson(res, 202, { ok: true, jobId, async: true }, c);
      return true;
    }
    try {
      const finished = await runCollaborationWorkflow(baseConfig, workflow);
      const report = buildWorkflowReport(finished);
      sendJson(
        res,
        200,
        {
          ok: true,
          workflowId: finished.workflowId,
          status: finished.status,
          report,
          steps: finished.steps.map((s) => ({
            stepId: s.stepId,
            assignee: s.assignee,
            status: s.status,
            error: s.error,
          })),
        },
        c,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(
        res,
        500,
        { ok: false, error: "workflow_run_failed", message: msg, workflowId: workflow.workflowId },
        c,
      );
    }
    return true;
  }

  if (pathname === "/api/collaboration-events" && req.method === "GET") {
    const since = url.searchParams.get("since") ?? undefined;
    let events = readCollaborationEvents(workspaceDir);
    if (since) {
      const sinceMs = Date.parse(since);
      if (Number.isFinite(sinceMs)) {
        events = events.filter((event) => Date.parse(event.timestamp) >= sinceMs);
      }
    }
    sendJson(res, 200, { ok: true, events: events.slice(-200), total: events.length }, c);
    return true;
  }

  return false;
}
