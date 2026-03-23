/**
 * Inter-assistant collaboration types.
 *
 * Adapted from OpenClaw's agent-to-agent patterns:
 *   - Session key hierarchy (src/routing/session-key.ts)
 *   - Subagent registry records (src/agents/subagent-registry.ts)
 *   - A2A policy / announce flow (src/agents/subagent-announce.ts)
 */

// ─────────────────────────────────────────────
// 1. Collaboration Messages
// ─────────────────────────────────────────────

export type CollaborationMessageKind =
  | "delegate"
  | "consult"
  | "notify"
  | "review_request"
  | "result";

export type CollaborationMessage = {
  messageId: string;
  kind: CollaborationMessageKind;
  fromAssistantId: string;
  toAssistantId: string;
  /** Originating session (the caller's session) */
  sourceSessionId: string;
  matterId?: string;
  payload: string;
  /** For consult/review: extra structured context */
  context?: string;
  /** Links a result back to the originating delegation or consult */
  replyTo?: string;
  createdAt: string;
};

// ─────────────────────────────────────────────
// 2. Delegation Records
// ─────────────────────────────────────────────

export type DelegationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export type DelegationRecord = {
  delegationId: string;
  fromAssistantId: string;
  toAssistantId: string;
  task: string;
  matterId?: string;
  priority: "normal" | "high" | "low";
  status: DelegationStatus;
  /** The session created on the target assistant for this delegation */
  targetSessionId?: string;
  /** Frozen result text captured on completion (max 100KB, like OpenClaw's frozenResultText) */
  result?: string;
  error?: string;
  /** Nesting depth — prevents runaway recursive delegation */
  depth: number;
  startedAt: string;
  completedAt?: string;
};

// ─────────────────────────────────────────────
// 3. Review Request
// ─────────────────────────────────────────────

export type ReviewType = "accuracy" | "completeness" | "legal_risk" | "style";

export type ReviewFeedback = {
  reviewType: ReviewType;
  approved: boolean;
  issues: string[];
  suggestions: string[];
  summary: string;
};

// ─────────────────────────────────────────────
// 4. Collaboration Events (audit / lifecycle)
// ─────────────────────────────────────────────

export type CollaborationEventKind =
  | "delegation.created"
  | "delegation.started"
  | "delegation.completed"
  | "delegation.failed"
  | "delegation.timeout"
  | "delegation.cancelled"
  | "consult.sent"
  | "consult.replied"
  | "notify.sent"
  | "review.requested"
  | "review.completed";

export type CollaborationEvent = {
  eventId: string;
  kind: CollaborationEventKind;
  delegationId?: string;
  messageId?: string;
  fromAssistantId: string;
  toAssistantId: string;
  matterId?: string;
  detail?: string;
  timestamp: string;
};

// ─────────────────────────────────────────────
// 5. Collaboration Policy
// ─────────────────────────────────────────────

export type CollaborationPolicy = {
  /** Max active delegations a single assistant can have outstanding */
  maxActiveDelegationsPerAssistant: number;
  /** Max delegation nesting depth (prevents A -> B -> C -> ... runaway) */
  maxDelegationDepth: number;
  /** Default timeout for synchronous consult/review (ms) */
  defaultConsultTimeoutMs: number;
  /** Default timeout for async delegation (ms) */
  defaultDelegationTimeoutMs: number;
  /**
   * Allowlist: which assistants can communicate.
   * Empty means all assistants can communicate with each other.
   * Each entry is `fromId:toId` — directional.
   */
  allowedPairs: string[];
};

export const DEFAULT_COLLABORATION_POLICY: CollaborationPolicy = {
  maxActiveDelegationsPerAssistant: 5,
  maxDelegationDepth: 3,
  defaultConsultTimeoutMs: 60_000,
  defaultDelegationTimeoutMs: 300_000,
  allowedPairs: [],
};
