/**
 * Unified agent fleet model — Cursor Agents Window parity for LawMind.
 * Aggregates chat sessions, delegations, workflow jobs, queue items, and approvals.
 */

export type AgentRunKind =
  | "chat"
  | "delegation"
  | "workflow_job"
  | "queue_item"
  | "tool_approval"
  | "matter_approval"
  | "pending_review"
  /** Automation inbox item awaiting lawyer approve_send (may include tracked docx). */
  | "automation_send";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_clarification"
  | "awaiting_review"
  /** 回合未收口（应用退出/被杀）：等律师决定「继续本件」或「弃办」。 */
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled"
  | "scheduled";

/** 未完成的交办留在在办里，避免过一夜就从律师眼前消失。 */
export const FLEET_FAILED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function isSameLocalDay(iso: string, now = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return false;
  }
  const d = new Date(t);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * 今天办完的，以及近几日没有办完的，才进入在办。
 * 更早的已办完不占列表。
 */
export function isFleetSettledVisible(
  status: AgentRunStatus,
  stamp: string | undefined,
  now = new Date(),
): boolean {
  if (!stamp) {
    return false;
  }
  const t = Date.parse(stamp);
  if (!Number.isFinite(t) || t > now.getTime() + 60_000) {
    return false;
  }
  if (status === "failed") {
    return now.getTime() - t <= FLEET_FAILED_KEEP_MS;
  }
  if (status === "completed" || status === "cancelled") {
    return isSameLocalDay(stamp, now);
  }
  return false;
}

export type AgentRunProgress = {
  total: number;
  completed: number;
  running?: string[];
};

export type AgentRunSummary = {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  title: string;
  subtitle?: string;
  matterId?: string;
  assistantId?: string;
  assigneeLabel?: string;
  sessionId?: string;
  delegationId?: string;
  jobId?: string;
  approvalId?: string;
  queueItemId?: string;
  taskId?: string;
  workId?: string;
  actionId?: string;
  toolName?: string;
  progress?: AgentRunProgress;
  updatedAt: string;
  createdAt: string;
  /** Lower = higher priority in fleet sort */
  priority: number;
  /** 失败或超时的一句说明。不是交办原文。 */
  note?: string;
};

export type AssistantGrowthRatesView = {
  tasksReviewed: number;
  firstPassApprovals: number;
  materialRewrites: number;
  firstPassRate: number;
  rewriteRate: number;
};

export type AssistantGrowthRowView = {
  assistantId: string;
  roleId?: string;
  lifetime: AssistantGrowthRatesView;
  window: AssistantGrowthRatesView;
  pendingAdoptions: number;
  lastUpdatedAt?: string;
  rewriteAmplitude?: {
    samples: number;
    avgAbsCharDelta: number;
    avgAbsParagraphDelta: number;
    lastAbsCharDelta: number;
  };
};

export type AssistantGrowthReportView = {
  windowDays: number;
  assistants: AssistantGrowthRowView[];
};

export type AgentFleetSummary = {
  runs: AgentRunSummary[];
  specialization?: Record<
    string,
    {
      assistantId: string;
      roleId?: string;
      tasksReviewed: number;
      firstPassApprovals: number;
      materialRewrites: number;
      firstPassRate: number;
      lastUpdatedAt: string;
    }
  >;
  /** Windowed growth (same source as GET /api/assistants/growth) */
  growth?: AssistantGrowthReportView;
  counts: {
    total: number;
    active: number;
    awaitingAction: number;
    byKind: Record<AgentRunKind, number>;
  };
};

export type AgentPreset = {
  id: string;
  title: string;
  description: string;
  roleId?: string;
  deliverableType?: string;
  riskLevel?: string;
  practiceArea?: string;
  starterPrompt: string;
  sourcePath: string;
};
