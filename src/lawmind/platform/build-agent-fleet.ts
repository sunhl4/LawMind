import fs from "node:fs";
import path from "node:path";
import { listDelegations } from "../agent/collaboration/delegation-registry.js";
import type { DelegationStatus } from "../agent/collaboration/types.js";
import {
  DEFAULT_CHAT_SESSION_TITLE,
  displayChatSessionTitle,
  listSessionsForDesk,
} from "../agent/session.js";
import {
  applyDerivedInterruptedAction,
  isInterruptedTurnView,
  isSessionTurnLive,
} from "../agent/turn-interrupt.js";
import { listApprovalRequests, listWorkQueueItems } from "../application/services/queue-service.js";
import { listDraftReviewHeads, readDraft } from "../drafts/index.js";
import { readRedlineProposal } from "../drafts/redline-proposal.js";
import { listOpenWordReviews, syncWordReviewTicketsFromDrafts } from "../drafts/word-review.js";
import { listLawyerWorks } from "../work/store.js";
import {
  isFleetSettledVisible,
  type AgentFleetSummary,
  type AgentRunKind,
  type AgentRunStatus,
  type AgentRunSummary,
} from "./agent-fleet.js";
import { listOpenAutomationInbox } from "./lawyer-automations.js";
import { isOutboundToolName } from "./lawyer-outbound-decision.js";
import { listPendingToolApprovals } from "./pending-tool-approvals.js";
import { sanitizeLawyerFacingText, toolDisplayNameZh } from "./requires-action.js";
import { extractApprovalDocumentPreview } from "./tool-approval-diff.js";

export type WorkflowJobFleetInput = {
  jobId: string;
  status: string;
  matterId?: string;
  /** 律师看见的流程名。没有时才退回模板 id。 */
  name?: string;
  templateId?: string;
  workflowId?: string;
  /** 没办完时的一句原因。堆栈不要传进来。 */
  error?: string;
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

const ACTIVE_DELEGATION_STATUSES = new Set<DelegationStatus>([
  "pending",
  "running",
  "awaiting_lawyer",
]);
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
  if (status === "awaiting_lawyer") {
    return "awaiting_clarification";
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
  if (status === "awaiting_lawyer") {
    return "awaiting_clarification";
  }
  if (status === "completed" || status === "completed_after_timeout") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function delegationFileInWorkspace(workspaceDir: string, delegationId: string): boolean {
  return fs.existsSync(path.join(workspaceDir, "delegations", `${delegationId}.json`));
}

function lawyerNote(raw: string | undefined): string | undefined {
  const line = raw
    ?.split(/\r?\n/)
    .find((part) => part.trim())
    ?.trim();
  if (!line) {
    return undefined;
  }
  if (/^Error:|^\s*at\s+\S|\/Users\/|node_modules|stack/i.test(line)) {
    return undefined;
  }
  return line.slice(0, 180);
}

function lawyerFleetChatTitle(session: ReturnType<typeof listSessions>[number]): string {
  const titled = displayChatSessionTitle(session);
  if (titled !== DEFAULT_CHAT_SESSION_TITLE) {
    return titled;
  }
  const instruction = [...session.turns]
    .toReversed()
    .find((turn) => turn.instruction?.trim())?.instruction;
  const line = instruction
    ?.split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("【") && !part.startsWith("<<<"));
  return line?.slice(0, 72) || "这场对话";
}

function settledChat(
  session: ReturnType<typeof listSessions>[number],
  live: boolean,
): { status: AgentRunStatus; instruction: string; note?: string } | null {
  if (live) {
    return null;
  }
  const last = session.turns[session.turns.length - 1];
  if (!last?.instruction?.trim()) {
    return null;
  }
  if (last.status === "completed") {
    return { status: "completed", instruction: last.instruction.trim() };
  }
  if (last.status === "error") {
    return {
      status: "failed",
      instruction: last.instruction.trim(),
      note: lawyerNote(last.error),
    };
  }
  return null;
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

function lastTurnStatus(
  session: ReturnType<typeof listSessions>[number],
  live: boolean,
): AgentRunStatus | null {
  const last = session.turns[session.turns.length - 1];
  if (!last) {
    return null;
  }
  // 中断轮次（占位仍 running 但无活回合）：呈现为 interrupted，让律师能「继续/弃办」。
  if (!live && isInterruptedTurnView(last)) {
    return "interrupted";
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
  const sessions = listSessionsForDesk(workspaceDir);

  for (const session of sessions) {
    if (matterId && session.matterId !== matterId) {
      continue;
    }
    const live = isSessionTurnLive(workspaceDir, session.sessionId);
    // 中断轮次没有落盘待办：读时派生「继续本件 / 弃办」，否则在办里查不到可点的卡片。
    applyDerivedInterruptedAction(session, live);
    const pending = session.pendingRequiresAction ?? [];
    const turnStatus = lastTurnStatus(session, live);
    const hasPendingClarification = (session.pendingClarificationKeys?.length ?? 0) > 0;
    const showSession =
      pending.length > 0 ||
      turnStatus != null ||
      hasPendingClarification ||
      Boolean(session.collaborationDelegationId);
    if (!showSession) {
      const settled = settledChat(session, live);
      if (settled && isFleetSettledVisible(settled.status, session.updatedAt)) {
        runs.push({
          id: `chat:${session.sessionId}`,
          kind: "chat",
          status: settled.status,
          title: lawyerFleetChatTitle(session),
          subtitle: settled.instruction.slice(0, 180),
          note: settled.note,
          matterId: session.matterId,
          assistantId: session.assistantId,
          assigneeLabel: assistantLabel(assistantLabels, session.assistantId),
          sessionId: session.sessionId,
          updatedAt: session.updatedAt,
          createdAt: session.createdAt,
          priority: settled.status === "failed" ? 6 : 8,
        });
      }
      continue;
    }
    const outboundTool = pending.find(
      (a) => a.kind === "tool_approval" && isOutboundToolName(a.toolName),
    );
    const clarify = hasPendingClarification || pending.some((a) => a.kind === "clarification");
    // 门禁停下的缺口挂在待办里：本件在等律师处置，归入待拍板（不再被下面的
    // 「awaiting_approval → running」收回成办理中）。
    const gateStopPending = pending.some((a) => a.kind === "workflow_blocked");
    const status: AgentRunStatus = outboundTool
      ? "awaiting_approval"
      : clarify
        ? "awaiting_clarification"
        : turnStatus === "interrupted"
          ? "interrupted"
          : gateStopPending
            ? "awaiting_approval"
            : turnStatus === "awaiting_approval"
              ? "running"
              : (turnStatus ?? "running");
    runs.push({
      id: `chat:${session.sessionId}`,
      kind: "chat",
      status,
      title: lawyerFleetChatTitle(session),
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
    if (!delegationFileInWorkspace(workspaceDir, d.delegationId)) {
      continue;
    }
    const status = mapDelegationStatus(d.status);
    const active = ACTIVE_DELEGATION_STATUSES.has(d.status);
    const stamp = d.completedAt ?? d.startedAt;
    if (!active && !isFleetSettledVisible(status, stamp)) {
      continue;
    }
    const note =
      d.status === "completed_after_timeout"
        ? "超时后仍交回了结果"
        : d.status === "timeout"
          ? "超时，没有交回"
          : d.status === "awaiting_lawyer"
            ? d.error?.trim() || "等你确认后再继续"
            : undefined;
    runs.push({
      id: `delegation:${d.delegationId}`,
      kind: "delegation",
      status,
      title: d.task.slice(0, 120),
      subtitle: "交给另一位助手",
      note,
      matterId: d.matterId,
      assistantId: d.toAssistantId,
      assigneeLabel: assistantLabel(assistantLabels, d.toAssistantId),
      sessionId: d.targetSessionId,
      delegationId: d.delegationId,
      updatedAt: stamp,
      createdAt: d.startedAt,
      priority: active ? (status === "running" ? 1 : 2) : status === "failed" ? 6 : 8,
    });
  }

  for (const job of jobs) {
    if (matterId && job.matterId !== matterId) {
      continue;
    }
    const status = mapJobStatus(job.status);
    const stamp = job.updatedAt ?? job.createdAt;
    const active =
      status === "running" ||
      status === "queued" ||
      status === "scheduled" ||
      job.status === "awaiting_lawyer";
    if (!active && !isFleetSettledVisible(status, stamp)) {
      continue;
    }
    runs.push({
      id: `job:${job.jobId}`,
      kind: "workflow_job",
      status,
      title: job.name?.trim() || job.templateId || job.workflowId || "按流程办的一件",
      subtitle: "按流程",
      note: lawyerNote(job.error),
      matterId: job.matterId,
      jobId: job.jobId,
      progress: job.progress
        ? {
            total: job.progress.totalSteps,
            completed: job.progress.completedSteps,
            running: job.progress.runningStepIds,
          }
        : undefined,
      updatedAt: stamp,
      createdAt: job.createdAt,
      priority: active ? (status === "running" ? 1 : 3) : status === "failed" ? 6 : 8,
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

  for (const tool of listPendingToolApprovals(workspaceDir, { matterId, sessions })) {
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

  for (const item of listOpenAutomationInbox(workspaceDir, matterId)) {
    if (item.status !== "open" || !item.pendingSend?.to) {
      continue;
    }
    const att = item.pendingSend.attachmentRelativePaths ?? [];
    const attNote = att.length
      ? `附件 ${att.map((p) => p.split("/").pop() || p).join("、")}`
      : "无附件";
    runs.push({
      id: `automation-send:${item.id}`,
      kind: "automation_send",
      status: "awaiting_approval",
      title: item.title?.trim() || "交办待发信",
      subtitle: `${item.pendingSend.to} · ${item.pendingSend.subject} · ${attNote}`,
      matterId: item.matterId,
      taskId: item.draftTaskId,
      queueItemId: item.id,
      jobId: item.jobId,
      updatedAt: item.createdAt,
      createdAt: item.createdAt,
      priority: 1,
    });
  }

  for (const draft of listDraftReviewHeads(workspaceDir)) {
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
      subtitle: draft.reviewStatus === "modified" ? "修改后待审核" : "交付物待审核",
      matterId: draft.matterId,
      taskId: draft.taskId,
      updatedAt: draft.reviewedAt ?? draft.createdAt,
      createdAt: draft.createdAt,
      priority: 0,
    });
  }

  syncWordReviewTicketsFromDrafts(workspaceDir);
  for (const ticket of listOpenWordReviews(workspaceDir)) {
    const draft = readDraft(workspaceDir, ticket.taskId);
    const baseline = draft?.contractEdit?.baselineRelativePath?.trim();
    if (!draft || !baseline || !draft.outputPath?.trim()) {
      continue;
    }
    if (matterId && draft.matterId !== matterId) {
      continue;
    }
    const live = (readRedlineProposal(workspaceDir, ticket.taskId)?.hunks ?? []).filter(
      (hunk) => hunk.status !== "rejected",
    );
    if (live.length === 0) {
      continue;
    }
    const fileName = path.basename(ticket.baselineRel.replace(/\\/g, "/"));
    runs.push({
      id: `word-check:${ticket.taskId}`,
      kind: "word_check",
      status: "awaiting_review",
      title: fileName || "待核对",
      subtitle: `${live.length} 处修订 · 待核对`,
      matterId: draft.matterId,
      taskId: ticket.taskId,
      updatedAt: ticket.openedAt,
      createdAt: ticket.openedAt,
      priority: 0,
    });
  }

  attachLawyerWorkOverlay(workspaceDir, runs);
  // 助手自己的队列项不占在办名额，否则今天办完的会被挤出上限。
  // 待发出单独留在名额外面，和以前从待拍板汇总结进来时一样，不会被挤掉。
  const sends = runs.filter((run) => run.kind === "automation_send");
  const listed = runs.filter(
    (run) =>
      run.kind !== "automation_send" && !(run.kind === "queue_item" && run.status === "queued"),
  );
  listed.sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
  const sliced = [...listed.slice(0, limit), ...sends];

  const byKind = {} as Record<AgentRunKind, number>;
  for (const kind of [
    "chat",
    "delegation",
    "workflow_job",
    "queue_item",
    "tool_approval",
    "matter_approval",
    "pending_review",
    "word_check",
  ] as const) {
    byKind[kind] = sliced.filter((r) => r.kind === kind).length;
  }
  byKind.automation_send = sends.length;

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
