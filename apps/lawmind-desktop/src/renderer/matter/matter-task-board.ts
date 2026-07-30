import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { ArtifactDraft, TaskRecord } from "../../../../../src/lawmind/types.ts";
import { lawyerDeliverableTypeLabel } from "../lawmind-lawyer-labels";
import { taskRecordStatusLabel } from "../lawmind-execution-status-label";
import {
  approvalStatusLabel,
  queueKindLabel,
  reviewStatusLabel,
} from "./matter-display-labels";

export type TaskBoardRowKind = "task" | "queue" | "approval" | "draft" | "job";

export type TaskBoardJobInput = {
  jobId: string;
  workflowId: string;
  status: string;
  matterId?: string;
  createdAt: string;
  workflowName?: string;
  scheduledRunAt?: string;
};

export type TaskBoardRow = {
  id: string;
  kind: TaskBoardRowKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  sortKey: string;
  priority: number;
  taskId?: string;
  draftTaskId?: string;
};

const QUEUE_PHASE_ZH: Record<string, string> = {
  plan: "规划",
  research: "检索",
  draft: "起草",
  review: "审核",
  render: "渲染",
};

const QUEUE_STATUS_ZH: Record<string, string> = {
  open: "待处理",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

function queueStatusLabel(status: string): string {
  return QUEUE_STATUS_ZH[status] ?? status;
}

const TASK_KIND_ZH: Record<string, string> = {
  "research.general": "通用检索整理",
  "research.legal": "法律专项检索",
  "research.hybrid": "通用与法律联合检索",
  "draft.word": "生成 Word 文书",
  "draft.ppt": "生成演示文稿",
  "summarize.case": "案件摘要",
  "analyze.contract": "合同审查",
  "agent.instruction": "对话交办",
  unknown: "待人工确认",
};

export function taskKindLabel(kind: string): string {
  return TASK_KIND_ZH[kind] ?? kind;
}

/** Re-export canonical queue kind labels (single source: matter-display-labels). */
export { queueKindLabel };

const JOB_STATUS_ZH: Record<string, string> = {
  scheduled: "已预约",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_ZH[status] ?? status;
}

export function mergeTaskBoardRows(input: {
  tasks: TaskRecord[];
  queueItems: WorkQueueItem[];
  approvalRequests: ApprovalRequest[];
  drafts: ArtifactDraft[];
  jobs?: TaskBoardJobInput[];
}): TaskBoardRow[] {
  const rows: TaskBoardRow[] = [];

  for (const t of input.tasks) {
    rows.push({
      id: `task:${t.taskId}`,
      kind: "task",
      title: t.summary.slice(0, 120) || t.taskId,
      subtitle: taskKindLabel(t.kind),
      statusLabel: taskRecordStatusLabel(t),
      sortKey: t.updatedAt ?? t.createdAt ?? "",
      priority: 2,
      taskId: t.taskId,
    });
  }

  for (const q of input.queueItems) {
    if (q.status !== "open" && q.status !== "in_progress") {
      continue;
    }
    const blocked = q.blockedReason?.trim();
    const depends =
      q.dependsOn && q.dependsOn.length > 0 ? `依赖 ${q.dependsOn.length} 项` : "";
    const phase = q.phase ? QUEUE_PHASE_ZH[q.phase] ?? q.phase : "";
    const kindLabel = queueKindLabel(q.kind);
    const subtitleParts = [phase || kindLabel, depends, blocked].filter(Boolean);
    rows.push({
      id: `queue:${q.queueItemId}`,
      kind: "queue",
      title: q.title,
      subtitle: subtitleParts.length ? subtitleParts.join(" · ") : kindLabel,
      statusLabel: queueStatusLabel(q.status),
      sortKey: q.updatedAt ?? q.createdAt ?? "",
      priority: q.priority === "critical" ? 0 : q.priority === "high" ? 1 : 3,
      taskId: q.relatedTaskId,
    });
  }

  for (const j of input.jobs ?? []) {
    if (j.status !== "queued" && j.status !== "running" && j.status !== "scheduled") {
      continue;
    }
    const scheduleHint =
      j.status === "scheduled" && j.scheduledRunAt
        ? `预约 ${j.scheduledRunAt.slice(0, 16).replace("T", " ")}`
        : "团队工作流";
    rows.push({
      id: `job:${j.jobId}`,
      kind: "job",
      title: j.workflowName ?? j.workflowId,
      subtitle: scheduleHint,
      statusLabel: jobStatusLabel(j.status),
      sortKey: j.scheduledRunAt ?? j.createdAt,
      priority: j.status === "running" ? 0 : j.status === "scheduled" ? 1 : 2,
    });
  }

  for (const a of input.approvalRequests) {
    if (a.status !== "pending") {
      continue;
    }
    rows.push({
      id: `approval:${a.approvalId}`,
      kind: "approval",
      title: a.reason.slice(0, 120),
      subtitle: a.targetRole ? `→ ${a.targetRole}` : "审批",
      statusLabel: approvalStatusLabel(a.status),
      sortKey: a.requestedAt,
      priority: 0,
    });
  }

  for (const d of input.drafts) {
    rows.push({
      id: `draft:${d.taskId}`,
      kind: "draft",
      title: d.title,
      subtitle: lawyerDeliverableTypeLabel(d.deliverableType) ?? d.output ?? "草稿",
      statusLabel: reviewStatusLabel(d.reviewStatus),
      sortKey: d.createdAt ?? "",
      priority: d.reviewStatus === "pending" ? 1 : 4,
      draftTaskId: d.taskId,
      taskId: d.taskId,
    });
  }

  return rows.toSorted((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.sortKey.localeCompare(a.sortKey);
  });
}
