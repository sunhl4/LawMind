/**
 * Orchestrator types — multi-assistant workflow definitions.
 *
 * The orchestrator translates lawyer directives (natural language or structured)
 * into executable workflows with dependency graphs, then dispatches steps to
 * the appropriate assistants via the collaboration tools.
 */

// ─────────────────────────────────────────────
// 1. Workflow Definition
// ─────────────────────────────────────────────

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type WorkflowStep = {
  stepId: string;
  /** Which assistant handles this step */
  assignee: string;
  /**
   * W8：可选 — 按 Role 委派；当指定时，executor 优先按 roleId 解析候选助手，
   * 解析失败再回退到 `assignee`。
   */
  assigneeRoleId?: string;
  /** Task description for the assignee */
  task: string;
  /** Steps that must complete before this one can start */
  dependsOn: string[];
  /** Optional: another assistant reviews the output */
  reviewBy?: string;
  /** If true, skip human review for this step */
  autoApprove: boolean;
  status: WorkflowStepStatus;
  /** Delegation ID once dispatched */
  delegationId?: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type WorkflowStatus = "draft" | "running" | "completed" | "failed" | "cancelled";

export type CollaborationWorkflow = {
  workflowId: string;
  name: string;
  description: string;
  matterId?: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** 模板级工具预批准（executor 仅放行白名单内工具）。 */
  preApproveToolNames?: string[];
};

// ─────────────────────────────────────────────
// 2. Directive Parsing
// ─────────────────────────────────────────────

/** A parsed step from natural language, before full workflow assembly */
export type ParsedDirectiveStep = {
  assigneeHint: string;
  task: string;
  dependsOnHints: string[];
  reviewByHint?: string;
};

export type ParsedDirective = {
  name: string;
  description: string;
  matterId?: string;
  steps: ParsedDirectiveStep[];
};

// ─────────────────────────────────────────────
// 3. Workflow Events
// ─────────────────────────────────────────────

export type WorkflowEventKind =
  | "workflow.created"
  | "workflow.started"
  | "workflow.step_started"
  | "workflow.step_completed"
  | "workflow.step_failed"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled";

export type WorkflowEvent = {
  eventId: string;
  workflowId: string;
  stepId?: string;
  kind: WorkflowEventKind;
  detail?: string;
  timestamp: string;
};
