/**
 * Unified approval routes: list, approve, reject.
 *
 * Serves both session-level tool approvals (resume via runtime-resume) and
 * matter-level approval records (resolve via approval-service).
 * After any mutation, emits `approval:update` on the SSE bus so all UIs
 * (chat, document desk, work queue) see the same pending list.
 */

import { createLegalToolRegistry } from "../../../src/lawmind/agent/tools/index.js";
import { resumeTurn } from "../../../src/lawmind/agent/runtime-resume.js";
import { listSessions } from "../../../src/lawmind/agent/session.js";
import { resolveApproval } from "../../../src/lawmind/application/services/approval-service.js";
import { listApprovalRequests } from "../../../src/lawmind/application/services/queue-service.js";
import type { ApprovalRecord } from "../../../src/lawmind/application/services/approval-service.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { listPendingToolApprovals } from "../../../src/lawmind/platform/pending-tool-approvals.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { buildAgentConfig, resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

export type UnifiedApprovalItem = {
  id: string;
  kind: "tool_approval" | "matter_approval";
  title: string;
  summary: string;
  matterId?: string;
  sessionId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  /** Computed TTL (24h from creation) for the UI. */
  expiresAt: string;
  decisions: Array<"approve" | "reject" | "more_info">;
};

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function resolveToolApprovalRiskLevel(toolName?: string): ApprovalRecord["riskLevel"] {
  if (!toolName) {
    return "medium";
  }
  if (toolName === "send_email" || toolName === "prepare_outbound_mail") {
    return "high";
  }
  if (
    toolName === "apply_surgical_edits" ||
    toolName === "write_document" ||
    toolName === "update_draft" ||
    toolName === "execute_workflow"
  ) {
    return "medium";
  }
  return "low";
}

function addTtl(iso: string): string {
  return new Date(new Date(iso).getTime() + APPROVAL_TTL_MS).toISOString();
}

function toolApprovalToUnified(item: ReturnType<typeof listPendingToolApprovals>[number]): UnifiedApprovalItem {
  return {
    id: item.actionId,
    kind: "tool_approval",
    title: item.title,
    summary: item.summary,
    matterId: item.matterId,
    sessionId: item.sessionId,
    toolName: item.toolName,
    toolArgs: item.toolArgs,
    riskLevel: resolveToolApprovalRiskLevel(item.toolName),
    createdAt: item.createdAt,
    expiresAt: addTtl(item.createdAt),
    decisions: ["approve", "reject", "more_info"],
  };
}

function matterApprovalToUnified(item: ApprovalRecord): UnifiedApprovalItem {
  return {
    id: item.approvalId,
    kind: "matter_approval",
    title: `待审批：${item.matterId}`,
    summary: item.reason,
    matterId: item.matterId,
    toolName: undefined,
    toolArgs: undefined,
    riskLevel: item.riskLevel,
    createdAt: item.requestedAt,
    expiresAt: addTtl(item.requestedAt),
    decisions: ["approve", "reject", "more_info"],
  };
}

type FoundApproval =
  | { kind: "tool_approval"; sessionId: string; actionId: string; item: UnifiedApprovalItem }
  | { kind: "matter_approval"; matterId: string; approvalId: string; item: UnifiedApprovalItem };

async function findApprovalById(
  workspaceDir: string,
  id: string,
): Promise<FoundApproval | null> {
  // 1. Search session-level tool approvals first (cheaper).
  for (const session of listSessions(workspaceDir)) {
    for (const action of session.pendingRequiresAction ?? []) {
      if (action.kind === "tool_approval" && action.id === id) {
        return {
          kind: "tool_approval",
          sessionId: session.sessionId,
          actionId: action.id,
          item: {
            id: action.id,
            kind: "tool_approval",
            title: action.title,
            summary: action.summary,
            matterId: action.matterId,
            sessionId: session.sessionId,
            toolName: action.toolName,
            toolArgs: action.toolArgs,
            riskLevel: resolveToolApprovalRiskLevel(action.toolName),
            createdAt: action.createdAt,
            expiresAt: addTtl(action.createdAt),
            decisions: ["approve", "reject", "more_info"],
          },
        };
      }
    }
  }

  // 2. Search matter-level approvals across all matters.
  const allMatter = await listApprovalRequests(workspaceDir, { status: "pending" });
  const found = allMatter.find((a) => a.approvalId === id);
  if (found) {
    return {
      kind: "matter_approval",
      matterId: found.matterId,
      approvalId: found.approvalId,
      item: matterApprovalToUnified(found),
    };
  }

  return null;
}

async function resolveToolApproval(
  workspaceDir: string,
  envFile: string | undefined,
  found: FoundApproval & { kind: "tool_approval" },
  decision: "approve" | "reject",
  resolvedBy: string,
) {
  const built = buildAgentConfig(workspaceDir, { envFile });
  if (built.error) {
    return { error: "模型未配置，无法继续。" as const };
  }
  const registry = createLegalToolRegistry({
    allowWebSearch: built.config.allowWebSearch === true,
    enableCollaboration: built.config.enableCollaboration === true,
    baseConfig: built.config.enableCollaboration ? built.config : undefined,
  });
  const input = {
    sessionId: found.sessionId,
    actionId: found.actionId,
    decision: decision === "approve" ? ("approve" as const) : ("reject" as const),
    resolvedBy,
  };
  const result = await resumeTurn(built.config, registry, input, { registry });
  return { result };
}

async function resolveMatterApproval(
  workspaceDir: string,
  found: FoundApproval & { kind: "matter_approval" },
  decision: "approve" | "reject",
  resolvedBy: string,
) {
  const result = resolveApproval(workspaceDir, found.matterId, found.approvalId, {
    status: decision === "approve" ? "approved" : "rejected",
    resolvedBy,
  });
  if (result.outcome === "not_found") {
    return { error: "approval_not_found" as const };
  }
  if (result.outcome === "already_resolved") {
    return { error: "approval_already_resolved" as const, approval: result.approval };
  }
  return { result: result.approval };
}

export async function handleApprovalRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;

  if (pathname === "/api/approvals" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const matterFilter = matterId && isValidMatterId(matterId) ? matterId : undefined;
    if (matterId && !matterFilter) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const [toolApprovals, matterApprovals] = await Promise.all([
      Promise.resolve(listPendingToolApprovals(workspaceDir, { matterId: matterFilter })),
      listApprovalRequests(workspaceDir, { status: "pending", matterId: matterFilter }),
    ]);
    const items: UnifiedApprovalItem[] = [
      ...toolApprovals.map(toolApprovalToUnified),
      ...matterApprovals.map(matterApprovalToUnified),
    ].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, 200, { ok: true, items, decisionTotal: items.length }, c);
    return true;
  }

  const match = /^\/api\/approvals\/([^/]+)\/(approve|reject)$/.exec(pathname);
  if (match && req.method === "POST") {
    const id = decodeURIComponent(match[1] ?? "");
    const decision = match[2] as "approve" | "reject";
    if (!id) {
      sendJsonError(res, 400, "invalid_approval_id", "审批 ID 不能为空。", c);
      return true;
    }

    const found = await findApprovalById(workspaceDir, id);
    if (!found) {
      sendJsonError(res, 404, "approval_not_found", "未找到该审批项。", c);
      return true;
    }

    const resolvedBy = resolveDesktopActorId();

    if (found.kind === "tool_approval") {
      const resolved = await resolveToolApproval(workspaceDir, envFile, found, decision, resolvedBy);
      if (resolved.error) {
        sendJsonError(res, 503, "model_not_configured", resolved.error, c);
        return true;
      }
      const matterId = found.item.matterId;
      ctx.sseBus?.emit({
        type: "approval:update",
        data: { matterId, approvalId: id, decision, kind: "tool_approval" },
      });
      sendJson(res, 200, { ok: true, turn: resolved.result?.turn }, c);
      return true;
    }

    const resolved = await resolveMatterApproval(workspaceDir, found, decision, resolvedBy);
    if (resolved.error === "approval_not_found") {
      sendJsonError(res, 404, "approval_not_found", "未找到该审批项。", c);
      return true;
    }
    if (resolved.error === "approval_already_resolved") {
      sendJsonError(
        res,
        409,
        "approval_already_resolved",
        "该审批已被处理，当前状态未变更。",
        c,
        { approval: resolved.approval },
      );
      return true;
    }
    ctx.sseBus?.emit({
      type: "approval:update",
      data: { matterId: found.matterId, approvalId: id, decision, kind: "matter_approval" },
    });
    sendJson(res, 200, { ok: true, approval: resolved.result }, c);
    return true;
  }

  return false;
}
