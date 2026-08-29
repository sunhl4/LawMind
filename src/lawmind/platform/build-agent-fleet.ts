import { listDelegations } from "../agent/collaboration/delegation-registry.js";
import type { DelegationStatus } from "../agent/collaboration/types.js";
import { listSessions, displayChatSessionTitle } from "../agent/session.js";
import { listApprovalRequests, listWorkQueueItems } from "../application/services/queue-service.js";
import { listDrafts } from "../drafts/index.js";
import { listLawyerWorks } from "../work/store.js";
import type {
  AgentFleetSummary,
  AgentRunKind,
  AgentRunStatus,
  AgentRunSummary,
} from "./agent-fleet.js";
import { isOutboundToolName } from "./lawyer-outbound-decision.js";
import { listPendingToolApprovals } from "./pending-tool-approvals.js";
import { sanitizeLawyerFacingText, toolDisplayNameZh } from "./requires-action.js";
import { extractApprovalDocumentPreview } from "./tool-approval-diff.js";

export type WorkflowJobFleetInput = {
  jobId: string;
  status: string;
  matterId?: string;
  templateId?: string;
  workflowId?: string;
  createdAt: string;
  updatedAt?: string;
  progress?: {
    totalSteps: number;
    completedSteps: number;
    runningStepIds?: string[];
  };
};

export type BuildAgentFleetOpts = {
  workspaceDir: string;
  matterId?: string;
  jobs?: WorkflowJobFleetInput[];
  assistantLabels?: Record<string, string>;
  limit?: number;
};

const ACTIVE_JOB_STATUSES = new Set(["scheduled", "queued", "running"]);
const ACTIVE_DELEGATION_STATUSES = new Set<DelegationStatus>(["pending", "running"]);
const AWAITING_ACTION_STATUSES = new Set<AgentRunStatus>([
  "awaiting_approval",
  "awaiting_clarification",
  "awaiting_review",
  "queued",
  "running",
  "scheduled",
]);

function mapJobStatus(status: string): AgentRunStatus {
  if (status === "scheduled") {
    return "scheduled";
  }
  if (status === "queued") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function mapDelegationStatus(status: DelegationStatus): AgentRunStatus {
  if (status === "pending") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function assistantLabel(
  labels: Record<string, string> | undefined,
  id?: string,
): string | undefined {
  if (!id?.trim()) {
    return undefined;
  }
  return labels?.[id] ?? id;
}

function lastTurnStatus(session: ReturnType<typeof listSessions>[number]): AgentRunStatus | null {
  const last = session.turns[session.turns.length - 1];
  if (!last) {
    return null;
  }
  if (last.status === "awaiting_clarification") {
    return "awaiting_clarification";
  }
  if (
    last.status === "awaiting_approval" ||
    last.status === "paused" ||
    last.executionState?.status === "awaiting_approval"
  ) {
    return "awaiting_approval";
  }
  if (last.status === "running" || last.executionState?.status === "running") {
    return "running";
  }
  return null;
}

function attachLawyerWorkOverlay(workspaceDir: string, runs: AgentRunSummary[]): void {
  const works = listLawyerWorks(workspaceDir);
  if (works.length === 0) {
    return;
  }
  for (const run of runs) {
    const work = works.find(
      (item) =>
        (run.sessionId && item.sessionId === run.sessionId) ||
        (run.taskId && (item.taskId === run.taskId || item.draftId === run.taskId)),
    );
    if (!work) {
      continue;
    }
    run.workId = work.workId;
    if (work.title.trim()) {
      run.title = work.title;
    }
    if (work.goal.trim()) {
      run.subtitle = `本件：${work.goal}`;
    }
  }
}

function chatPriority(status: AgentRunStatus): number {
  if (status === "awaiting_approval") {
    return 0;
  }
  if (status === "awaiting_clarification") {
    return 1;
  }
  if (status === "running") {
    return 2;
  }
  return 5;
}

export async function buildAgentFleetSummary(
  opts: BuildAgentFleetOpts,
): Promise<AgentFleetSummary> {
  const { workspaceDir, matterId, jobs = [], assistantLabels, limit = 80 } = opts;
  const runs: AgentRunSummary[] = [];

  for (const session of listSessions(workspaceDir)) {
    if (matterId && session.matterId !== matterId) {
      continue;
    }
    const pending = session.pendingRequiresAction ?? [];
    const turnStatus = lastTurnStatus(session);
    const hasPendingClarification = (session.pendingClarificationKeys?.length ?? 0) > 0;
    const showSession =
      pending.length > 0 ||
      turnStatus != null ||
      hasPendingClarification ||
      Boolean(session.collaborationDelegationId);
    if (!showSession) {
      continue;
    }
    const outboundTool = pending.find(
      (a) => a.kind === "tool_approval" && isOutboundToolName(a.toolName),
    );
    const clarify = hasPendingClarification || pending.some((a) => a.kind === "clarification");
    const status: AgentRunStatus = outboundTool
      ? "awaiting_approval"
      : clarify
        ? "awaiting_clarification"
        : turnStatus === "awaiting_approval"
          ? "running"
          : (turnStatus ?? "running");
    runs.push({
      id: `chat:${session.sessionId}`,
      kind: "chat",
      status,
      title: displayChatSessionTitle(session),
      subtitle: session.collaborationDelegationId ? "委派子会话" : "对话 Agent",
      matterId: session.matterId,
      assistantId: session.assistantId,
      assigneeLabel: assistantLabel(assistantLabels, session.assistantId),
      sessionId: session.sessionId,
      toolName: outboundTool?.toolName,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      priority: chatPriority(status),
    });
  }

  for (const d of listDelegations({ matterId, status: undefined })) {
    if (!ACTIVE_DELEGATION_STATUSES.has(d.status)) {
      continue;
    }
    const status = mapDelegationStatus(d.status);
    runs.push({
      id: `delegation:${d.delegationId}`,
      kind: "delegation",
      status,
      title: d.task.slice(0, 120),
      subtitle: "委派",
      matterId: d.matterId,
      assistantId: d.toAssistantId,
      assigneeLabel: assistantLabel(assistantLabels, d.toAssistantId),
      sessionId: d.targetSessionId,
      delegationId: d.delegationId,
      updatedAt: d.completedAt ?? d.startedAt,
      createdAt: d.startedAt,
      priority: status === "running" ? 1 : 2,
    });
  }

  for (const job of jobs) {
    if (!ACTIVE_JOB_STATUSES.has(job.status)) {
      continue;
    }
    if (matterId && job.matterId !== matterId) {
      continue;
    }
    const status = mapJobStatus(job.status);
    runs.push({
      id: `job:${job.jobId}`,
      kind: "workflow_job",
      status,
      title: job.templateId ?? job.workflowId ?? "工作流",
      subtitle: "团队工作流",
      matterId: job.matterId,
      jobId: job.jobId,
      progress: job.progress
        ? {
            total: job.progress.totalSteps,
            completed: job.progress.completedSteps,
            running: job.progress.runningStepIds,
          }
        : undefined,
      updatedAt: job.updatedAt ?? job.createdAt,
      createdAt: job.createdAt,
      priority: status === "running" ? 1 : 3,
    });
  }

  const [queueItems, approvals] = await Promise.all([
    listWorkQueueItems(workspaceDir, { matterId, status: "open" }),
    listApprovalRequests(workspaceDir, { matterId, status: "pending" }),
  ]);

  /** 待拍板只拦外发；问客户算出局。内部审稿不进待拍板。 */
  const LAWYER_FACING_QUEUE_KINDS = new Set(["need_client_input"]);

  for (const item of queueItems) {
    // 律师拍板类队列项映射为 awaiting_approval（进入待拍板队列）；
    // 其余（ready_to_draft / blocked_* 等助手侧工作）保持 queued，由过滤层排除。
    const lawyerFacing = LAWYER_FACING_QUEUE_KINDS.has(item.kind);
    runs.push({
      id: `queue:${item.queueItemId}`,
      kind: "queue_item",
      status: lawyerFacing ? "awaiting_approval" : "queued",
      title: item.title,
      subtitle: item.phase ?? "工作队列",
      matterId: item.matterId,
      queueItemId: item.queueItemId,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      priority: 4,
    });
  }

  for (const approval of approvals) {
    runs.push({
      id: `approval:${approval.approvalId}`,
      kind: "matter_approval",
      status: "awaiting_approval",
      title: approval.reason.slice(0, 120) || "案件审批",
      subtitle: "案件审批",
      matterId: approval.matterId,
      approvalId: approval.approvalId,
      updatedAt: approval.resolvedAt ?? approval.requestedAt,
      createdAt: approval.requestedAt,
      priority: 0,
    });
  }

  for (const tool of listPendingToolApprovals(workspaceDir, { matterId })) {
    if (!isOutboundToolName(tool.toolName)) {
      continue;
    }
    if (runs.some((r) => r.actionId === tool.actionId)) {
      continue;
    }
    const preview = tool.toolArgs ? extractApprovalDocumentPreview(tool.toolArgs) : null;
    const toolLabel = tool.toolName ? toolDisplayNameZh(tool.toolName) : "待批准操作";
    runs.push({
      id: `tool:${tool.actionId}`,
      kind: "tool_approval",
      status: "awaiting_approval",
      title: preview?.title
        ? `待审定：${preview.title}`
        : sanitizeLawyerFacingText(tool.title, tool.toolName),
      subtitle: preview ? "拟落稿" : toolLabel,
      matterId: tool.matterId,
      sessionId: tool.sessionId,
      actionId: tool.actionId,
      toolName: tool.toolName,
      updatedAt: tool.createdAt,
      createdAt: tool.createdAt,
      priority: 0,
    });
  }

  for (const draft of listDrafts(workspaceDir)) {
    if (matterId && draft.matterId !== matterId) {
      continue;
    }
    if (draft.reviewStatus !== "pending" && draft.reviewStatus !== "modified") {
      continue;
    }
    runs.push({
      id: `review:${draft.taskId}`,
      kind: "pending_review",
      status: "awaiting_review",
      title: draft.title?.trim() || "待审核草稿",
      subtitle: draft.reviewStatus === "modified" ? "修改后待复核" : "交付物待审核",
      matterId: draft.matterId,
      taskId: draft.taskId,
      updatedAt: draft.reviewedAt ?? draft.createdAt,
      createdAt: draft.createdAt,
      priority: 0,
    });
  }

  attachLawyerWorkOverlay(workspaceDir, runs);
  runs.sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
  const sliced = runs.slice(0, limit);

  const byKind = {} as Record<AgentRunKind, number>;
  for (const kind of [
    "chat",
    "delegation",
    "workflow_job",
    "queue_item",
    "tool_approval",
    "matter_approval",
    "pending_review",
  ] as const) {
    byKind[kind] = sliced.filter((r) => r.kind === kind).length;
  }

  return {
    runs: sliced,
    counts: {
      total: sliced.length,
      active: sliced.filter((r) => AWAITING_ACTION_STATUSES.has(r.status)).length,
      awaitingAction: sliced.filter(
        (r) =>
          r.status === "awaiting_approval" ||
          r.status === "awaiting_clarification" ||
          r.status === "awaiting_review",
      ).length,
      byKind,
    },
  };
}
