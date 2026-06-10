import type { AuditEvent, ArtifactDraft, MatterIndex, ReviewStatus, TaskRecord } from "../types.js";
import type { DeliverableLifecycleStatus } from "./deliverable-lifecycle.js";
import {
  classifyAudience,
  classifyDeliverableKind,
  deriveDeliverableStatus,
  deriveMatterSensitivity,
  deriveMatterStatus,
  deriveMatterTitle,
  deriveNextActions,
  deriveStrategyStatus,
  needsEvidenceFollowup,
  queuePriorityFromRisk,
} from "./derive.js";

export {
  classifyAudience,
  classifyDeliverableKind,
  deriveDeliverableStatus,
  deriveMatterSensitivity,
  deriveMatterStatus,
  deriveMatterTitle,
  deriveNextActions,
  deriveStrategyStatus,
  needsEvidenceFollowup,
  queuePriorityFromRisk,
} from "./derive.js";

export type MatterStatus =
  | "intake"
  | "active"
  | "waiting_on_client"
  | "waiting_on_firm"
  | "under_review"
  | "delivered"
  | "closed";

export type DeliverableKind =
  | "legal-memo"
  | "contract-review"
  | "demand-letter"
  | "litigation-outline"
  | "client-brief"
  | "evidence-timeline"
  | "general-document";

export type Matter = {
  matterId: string;
  clientId?: string;
  title: string;
  status: MatterStatus;
  sensitivity: "normal" | "high" | "restricted";
  ownerLawyerId?: string;
  primaryAssistantRoleId?: string;
  strategyStatus: "missing" | "draft" | "approved" | "stale";
  openQuestionIds: string[];
  nextActions: string[];
  deadlineIds: string[];
  deliverableIds: string[];
  queueItemIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type Deliverable = {
  deliverableId: string;
  matterId: string;
  taskId?: string;
  kind: DeliverableKind;
  audience: "internal" | "client" | "counterparty" | "court" | "unknown";
  status: DeliverableLifecycleStatus;
  templateId?: string;
  currentDraftTaskId?: string;
  currentReviewStatus?: ReviewStatus;
  blockingReasons: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequest = {
  approvalId: string;
  matterId: string;
  deliverableId?: string;
  requestedBy: string;
  requestedRole?: string;
  /** W3 起预留；W8 起 delegateToRole / 桌面待审批列表按此过滤。 */
  targetRole?: string;
  requestedAt: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "needs_changes";
  resolvedBy?: string;
  resolvedAt?: string;
};

export type Deadline = {
  deadlineId: string;
  matterId: string;
  title: string;
  dueAt: string;
  severity: "soft" | "hard" | "critical";
  source: "manual" | "case_memory" | "project_file" | "calendar_import";
  status: "open" | "snoozed" | "completed" | "missed";
  notes?: string;
};

export type QueueKind =
  | "need_client_input"
  | "need_evidence"
  | "need_conflict_check"
  | "need_lawyer_review"
  | "need_partner_approval"
  | "ready_to_draft"
  | "ready_to_render"
  | "blocked_by_deadline"
  | "blocked_by_missing_strategy";

export type WorkQueueItem = {
  queueItemId: string;
  matterId: string;
  kind: QueueKind;
  status: "open" | "in_progress" | "resolved" | "dismissed";
  priority: "low" | "normal" | "high" | "critical";
  title: string;
  detail?: string;
  relatedTaskId?: string;
  relatedDeliverableId?: string;
  dependsOn?: string[];
  blockedBy?: string[];
  blockedReason?: string;
  /** Ralph-style phase label (plan / research / draft / review / render). */
  phase?: "plan" | "research" | "draft" | "review" | "render";
  createdAt: string;
  updatedAt: string;
};

export type MemoryNode = {
  nodeId: string;
  scope: "firm" | "lawyer" | "client" | "matter" | "playbook" | "opponent" | "project";
  kind: "preference" | "rule" | "strategy" | "risk" | "clause_pattern" | "fact_gap";
  sourcePath: string;
  sourceAnchor?: string;
  summary: string;
  confidence?: number;
  conflictStatus?: "none" | "possible_conflict" | "conflict";
  adoptionStatus: "truth_source" | "suggested" | "approved" | "dismissed";
  updatedAt: string;
};

export type MatterReadModel = {
  matter: Matter;
  deliverables: Deliverable[];
  approvalRequests: ApprovalRequest[];
  queueItems: WorkQueueItem[];
  latestActivity: Array<{
    timestamp: string;
    label: string;
    taskId?: string;
  }>;
  source: MatterIndex;
};

export function buildDeliverableFromDraft(
  draft: ArtifactDraft,
  task?: TaskRecord,
): Deliverable | undefined {
  if (!draft.matterId) {
    return undefined;
  }
  const createdAt = draft.createdAt ?? task?.createdAt ?? new Date(0).toISOString();
  const updatedAt = draft.reviewedAt ?? task?.updatedAt ?? createdAt;
  const blockingReasons: string[] = [];
  if (draft.reviewStatus === "pending") {
    blockingReasons.push("awaiting_review");
  }
  if (draft.reviewStatus === "rejected") {
    blockingReasons.push("rejected_by_reviewer");
  }
  if (draft.reviewStatus === "modified") {
    blockingReasons.push("changes_requested");
  }
  return {
    deliverableId: draft.taskId,
    matterId: draft.matterId,
    taskId: draft.taskId,
    kind: classifyDeliverableKind(draft),
    audience: classifyAudience(draft.audience),
    status: deriveDeliverableStatus(draft),
    templateId: draft.templateId,
    currentDraftTaskId: draft.taskId,
    currentReviewStatus: draft.reviewStatus,
    blockingReasons,
    createdAt,
    updatedAt,
  };
}

export function buildMatterFromIndex(index: MatterIndex): Matter {
  const deliverableIds = index.drafts
    .filter((draft) => draft.matterId === index.matterId)
    .map((draft) => draft.taskId);
  const queueItems = buildQueueItemsFromMatterIndex(index);
  return {
    matterId: index.matterId,
    title: deriveMatterTitle(index),
    status: deriveMatterStatus(index),
    sensitivity: deriveMatterSensitivity(index),
    strategyStatus: deriveStrategyStatus(index),
    openQuestionIds: index.riskNotes.map((_, idx) => `${index.matterId}:risk:${idx + 1}`),
    nextActions: deriveNextActions(index),
    deadlineIds: [],
    deliverableIds,
    queueItemIds: queueItems.map((item) => item.queueItemId),
    updatedAt: index.latestUpdatedAt,
    createdAt: index.tasks
      .map((task) => task.createdAt)
      .toSorted()
      .at(0),
  };
}

export function buildApprovalRequestsFromMatterIndex(index: MatterIndex): ApprovalRequest[] {
  const approvals: ApprovalRequest[] = [];

  for (const task of index.tasks) {
    if (!task.requiresConfirmation) {
      continue;
    }
    const pending = task.status === "created";
    approvals.push({
      approvalId: `${task.taskId}:task-confirmation`,
      matterId: index.matterId,
      requestedBy: "system",
      requestedRole: "responsible-lawyer",
      requestedAt: task.createdAt,
      reason: "High-risk task requires lawyer confirmation before execution.",
      riskLevel: task.riskLevel,
      status: pending ? "pending" : task.status === "rejected" ? "rejected" : "approved",
      resolvedAt: pending ? undefined : task.updatedAt,
    });
  }

  for (const draft of index.drafts) {
    let status: ApprovalRequest["status"];
    if (draft.reviewStatus === "approved") {
      status = "approved";
    } else if (draft.reviewStatus === "rejected") {
      status = "rejected";
    } else if (draft.reviewStatus === "modified") {
      status = "needs_changes";
    } else {
      status = "pending";
    }
    approvals.push({
      approvalId: `${draft.taskId}:draft-review`,
      matterId: index.matterId,
      deliverableId: draft.taskId,
      requestedBy: "system",
      requestedRole: "reviewing-lawyer",
      requestedAt: draft.createdAt,
      reason: "Draft review is required before render and delivery.",
      riskLevel: index.tasks.find((task) => task.taskId === draft.taskId)?.riskLevel ?? "medium",
      status,
      resolvedBy: draft.reviewedBy,
      resolvedAt: status === "pending" ? undefined : draft.reviewedAt,
    });
  }

  return approvals.toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function buildQueueItemsFromMatterIndex(index: MatterIndex): WorkQueueItem[] {
  const items: WorkQueueItem[] = [];

  for (const task of index.tasks) {
    if (task.requiresConfirmation && task.status === "created") {
      items.push({
        queueItemId: `${task.taskId}:confirm`,
        matterId: index.matterId,
        kind: task.riskLevel === "high" ? "need_partner_approval" : "need_lawyer_review",
        status: "open",
        priority: queuePriorityFromRisk(task.riskLevel),
        title: `任务待确认：${task.summary}`,
        detail: "High-risk work should not proceed before confirmation.",
        relatedTaskId: task.taskId,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    }
  }

  for (const draft of index.drafts) {
    const task = index.tasks.find((item) => item.taskId === draft.taskId);
    if (draft.reviewStatus === "pending") {
      items.push({
        queueItemId: `${draft.taskId}:review`,
        matterId: index.matterId,
        kind: "need_lawyer_review",
        status: "open",
        priority: queuePriorityFromRisk(task?.riskLevel),
        title: `草稿待审核：${draft.title}`,
        detail: "Draft review is required before render.",
        relatedTaskId: draft.taskId,
        relatedDeliverableId: draft.taskId,
        createdAt: draft.createdAt,
        updatedAt: draft.createdAt,
      });
    }
    if (draft.reviewStatus === "modified" || draft.reviewStatus === "rejected") {
      items.push({
        queueItemId: `${draft.taskId}:revise`,
        matterId: index.matterId,
        kind: "ready_to_draft",
        status: "open",
        priority: queuePriorityFromRisk(task?.riskLevel),
        title: `草稿待修订：${draft.title}`,
        detail: "Review feedback requires a revised draft before delivery.",
        relatedTaskId: draft.taskId,
        relatedDeliverableId: draft.taskId,
        createdAt: draft.createdAt,
        updatedAt: draft.reviewedAt ?? draft.createdAt,
      });
    }
    if (draft.reviewStatus === "approved" && !draft.outputPath) {
      items.push({
        queueItemId: `${draft.taskId}:render`,
        matterId: index.matterId,
        kind: "ready_to_render",
        status: "open",
        priority: queuePriorityFromRisk(task?.riskLevel),
        title: `草稿可渲染：${draft.title}`,
        detail: "Approved draft is ready for render.",
        relatedTaskId: draft.taskId,
        relatedDeliverableId: draft.taskId,
        createdAt: draft.createdAt,
        updatedAt: draft.reviewedAt ?? draft.createdAt,
      });
    }
  }

  for (const note of index.riskNotes) {
    if (!needsEvidenceFollowup(note)) {
      continue;
    }
    const ts = index.latestUpdatedAt ?? new Date(0).toISOString();
    items.push({
      queueItemId: `${index.matterId}:evidence:${items.length + 1}`,
      matterId: index.matterId,
      kind: "need_evidence",
      status: "open",
      priority: "high",
      title: `待补材料：${note}`,
      detail: "Matter memory indicates unresolved evidence or factual gap.",
      createdAt: ts,
      updatedAt: ts,
    });
  }

  if (index.coreIssues.length === 0 && index.taskGoals.length === 0) {
    const ts = index.latestUpdatedAt ?? new Date(0).toISOString();
    items.push({
      queueItemId: `${index.matterId}:strategy`,
      matterId: index.matterId,
      kind: "blocked_by_missing_strategy",
      status: "open",
      priority: "normal",
      title: "案件策略仍不完整",
      detail: "Matter has not yet accumulated core issues or clear task goals.",
      createdAt: ts,
      updatedAt: ts,
    });
  }

  return items.toSorted((a, b) => {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function formatAuditLabel(event: AuditEvent): string {
  return `${event.kind}${event.detail ? `: ${event.detail}` : ""}`;
}

export function buildMatterReadModelFromIndex(index: MatterIndex): MatterReadModel {
  const tasksById = new Map(index.tasks.map((task) => [task.taskId, task] as const));
  const deliverables = index.drafts
    .map((draft) => buildDeliverableFromDraft(draft, tasksById.get(draft.taskId)))
    .filter((value): value is Deliverable => Boolean(value));
  const approvalRequests = buildApprovalRequestsFromMatterIndex(index);
  const queueItems = buildQueueItemsFromMatterIndex(index);

  const latestActivity = [
    ...index.auditEvents.map((event) => ({
      timestamp: event.timestamp,
      label: formatAuditLabel(event),
      taskId: event.taskId,
    })),
    ...index.tasks.map((task) => ({
      timestamp: task.updatedAt,
      label: `${task.status}: ${task.summary}`,
      taskId: task.taskId,
    })),
  ]
    .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 10);

  return {
    matter: buildMatterFromIndex(index),
    deliverables,
    approvalRequests,
    queueItems,
    latestActivity,
    source: index,
  };
}
