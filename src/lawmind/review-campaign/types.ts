/**
 * Review campaign — Skills epic E2 (Fleet Playbook + Safety Score).
 */

export type ReviewCampaignStatus =
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ReviewCampaignRoleStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type ReviewCampaignRoleId =
  | "clause"
  | "risk"
  | "compliance"
  | "obligation_timeline"
  | "citation_check";

export type FleetPlaybookRole = {
  id: ReviewCampaignRoleId;
  label: string;
  /** Weight in Safety Score (sum need not be 1; normalized at aggregate time) */
  weight: number;
  /** Soft timeout hint (ms) for Solo serial runner */
  timeoutMs: number;
  /** Tool allowlist for future Firm parallelism */
  toolAllowlist: string[];
  promptHint: string;
  /**
   * Workspace assistant Role / preset id for binding (e.g. contract_review).
   * When omitted, engine uses PLAYBOOK_ROLE_TO_WORKSPACE_ROLE defaults.
   */
  workspaceRoleId?: string;
  /** Explicit workspace assistant instance (wins over role match). */
  assistantId?: string;
};

export type FleetPlaybook = {
  id: string;
  label: string;
  version: number;
  deliverableTypes: string[];
  roles: FleetPlaybookRole[];
  /** Solo serial vs firm parallel (execution hint) */
  executionMode: "serial" | "parallel";
};

export type ReviewCampaignFinding = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** Negotiation priority 1 = highest */
  negotiatePriority?: number;
};

export type ReviewCampaignRoleResult = {
  roleId: ReviewCampaignRoleId;
  label: string;
  status: ReviewCampaignRoleStatus;
  weight: number;
  /** 0–100 role-local score (higher = safer) */
  score?: number;
  findings: ReviewCampaignFinding[];
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Resolved workspace Role / preset used for binding */
  workspaceRoleId?: string;
  /** Bound workspace assistant instance (when available) */
  boundAssistantId?: string;
  boundAssistantName?: string;
};

export type SafetyScore = {
  /** 0–100 aggregate */
  score: number;
  high: number;
  medium: number;
  low: number;
  negotiatePriority: Array<{
    roleId: ReviewCampaignRoleId;
    title: string;
    severity: ReviewCampaignFinding["severity"];
    priority: number;
  }>;
  computedAt: string;
};

export type ReviewCampaign = {
  id: string;
  matterId: string | null;
  taskId: string | null;
  playbookId: string;
  playbookLabel: string;
  status: ReviewCampaignStatus;
  createdAt: string;
  updatedAt: string;
  roles: ReviewCampaignRoleResult[];
  safetyScore?: SafetyScore;
  /** Linked workflow job when enqueued */
  jobId?: string;
  idempotencyKey?: string;
  error?: string;
  /** Source text snapshot used for heuristic/serial run */
  sourceText?: string;
  /** Actual runner mode after edition gate (S6) */
  executionModeUsed?: "serial" | "parallel";
  /** Solo「更快模式」：跳过低权重角色 */
  preferFast?: boolean;
};
