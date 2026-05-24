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
import { apiGetJson, apiSendJson } from "./api-client";

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
};

export async function loadActionSummary(
  apiBase: string,
  matterId?: string,
): Promise<ActionSummaryPayload> {
  const q = matterId?.trim() ? `?matterId=${encodeURIComponent(matterId.trim())}` : "";
  return apiGetJson<ActionSummaryPayload>(apiBase, `/api/action-summary${q}`);
}

export async function resumeChatAction(
  apiBase: string,
  body: {
    sessionId: string;
    actionId: string;
    decision: LawMindRequiresActionDecision;
    clarificationAnswers?: Record<string, string>;
    editedArgs?: Record<string, unknown>;
  },
): Promise<{
  ok?: boolean;
  reply?: string;
  sessionId?: string;
  status?: string;
  requiresAction?: LawMindRequiresAction[];
}> {
  return apiSendJson(apiBase, "/api/chat/resume", "POST", body);
}

export async function resolveMatterApproval(
  apiBase: string,
  body: {
    matterId: string;
    approvalId: string;
    status: "approved" | "rejected" | "needs_changes";
  },
): Promise<{ ok?: boolean }> {
  return apiSendJson(apiBase, "/api/approvals/resolve", "POST", body);
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
