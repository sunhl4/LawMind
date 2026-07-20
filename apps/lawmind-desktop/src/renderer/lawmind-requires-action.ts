/**
 * Desktop helpers for LawMindRequiresAction (chat + action hub).
 */

import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import {
  formatClarificationResumeMessage,
  type LawMindRequiresAction,
  type LawMindRequiresActionDecision,
} from "../../../../src/lawmind/platform/requires-action.ts";

export { formatClarificationResumeMessage };
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { apiGetJson } from "./api-client";
import type { ApprovalResolvePostRequest, ChatResumeRequest } from "./lawmind-api-request-types.ts";
import { apiPost } from "./lawmind-api-routes.ts";

export type { LawMindRequiresAction, LawMindRequiresActionDecision };

export function parseRequiresActionsFromResponse(raw: unknown): LawMindRequiresAction[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: LawMindRequiresAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.kind !== "string" ||
      typeof o.title !== "string" ||
      typeof o.summary !== "string" ||
      !Array.isArray(o.decisions)
    ) {
      continue;
    }
    out.push(item as LawMindRequiresAction);
  }
  return out;
}

export type ActionSummaryPayload = {
  ok?: boolean;
  total?: number;
  pendingApprovals?: number;
  openQueueItems?: number;
  activeJobs?: number;
  /** Items that require a lawyer decision now (excludes merely-running jobs). */
  requiresDecisionTotal?: number;
  pendingReviewCount?: number;
  pendingAutomationCount?: number;
  chatRequiresActionCount?: number;
  pendingToolApprovals?: number;
  toolApprovals?: Array<{
    actionId: string;
    sessionId: string;
    matterId?: string;
    toolName?: string;
    title: string;
    summary: string;
    toolArgs?: Record<string, unknown>;
    createdAt: string;
  }>;
  /** Workspace-wide pending chat interrupts (clarification / tool approval), not only active session. */
  chatRequiresActions?: Array<{
    sessionId: string;
    title: string;
    matterId?: string;
    assistantId?: string;
    actions: LawMindRequiresAction[];
  }>;
  pendingReviewDrafts?: Array<{
    taskId: string;
    matterId?: string;
    title: string;
    reviewStatus: "pending" | "modified";
    createdAt: string;
  }>;
  automationInbox?: Array<{
    id: string;
    automationId: string;
    matterId: string;
    title: string;
    summary: string;
    status: string;
    createdAt: string;
    draftTaskId?: string;
    jobId?: string;
    pendingSend?: { to: string; subject: string; body: string };
  }>;
};

export async function loadActionSummary(
  apiBase: string,
  matterId?: string,
): Promise<ActionSummaryPayload> {
  const t = matterId?.trim() ?? "";
  const q = t && isValidMatterId(t) ? `?matterId=${encodeURIComponent(t)}` : "";
  return apiGetJson<ActionSummaryPayload>(apiBase, `/api/action-summary${q}`);
}

export async function resumeChatAction(
  apiBase: string,
  body: ChatResumeRequest,
): Promise<{
  ok?: boolean;
  reply?: string;
  sessionId?: string;
  status?: string;
  requiresAction?: LawMindRequiresAction[];
}> {
  return apiPost(apiBase, "/api/chat/resume", body) as Promise<{
    ok?: boolean;
    reply?: string;
    sessionId?: string;
    status?: string;
    requiresAction?: LawMindRequiresAction[];
  }>;
}

export async function resolveMatterApproval(
  apiBase: string,
  body: ApprovalResolvePostRequest,
): Promise<{ ok?: boolean }> {
  return apiPost(apiBase, "/api/approvals/resolve", body);
}

export function buildClarificationAnswerMap(
  questions: ClarificationQuestion[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = values[q.key]?.trim();
    if (v) {
      out[q.key] = v;
    }
  }
  return out;
}
