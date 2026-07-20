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
  | "pending_review";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_clarification"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled"
  | "scheduled";

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
  actionId?: string;
  toolName?: string;
  progress?: AgentRunProgress;
  updatedAt: string;
  createdAt: string;
  /** Lower = higher priority in fleet sort */
  priority: number;
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
