/**
 * Unified interrupt / resume payload for clarification, tool approval, and matter approvals.
 * Aligns with docs/LAWMIND-INTERRUPT-RESUME.md (LangGraph-style human-in-the-loop).
 */

import type { AgentTurn } from "../agent/types.js";
import type { ClarificationQuestion } from "../types.js";

export type LawMindRequiresActionKind =
  | "clarification"
  | "tool_approval"
  | "matter_approval"
  | "workflow_blocked";

export type LawMindRequiresActionDecision = "approve" | "edit" | "reject" | "respond";

export type LawMindRequiresAction = {
  id: string;
  kind: LawMindRequiresActionKind;
  /** matterId:taskId:sessionId */
  threadId: string;
  title: string;
  summary: string;
  matterId?: string;
  sessionId?: string;
  taskId?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  clarificationQuestions?: ClarificationQuestion[];
  approvalId?: string;
  decisions: LawMindRequiresActionDecision[];
  createdAt: string;
};

export type ResumeRequiresActionInput = {
  sessionId: string;
  actionId: string;
  decision: LawMindRequiresActionDecision;
  editedArgs?: Record<string, unknown>;
  clarificationAnswers?: Record<string, string>;
  resolvedBy?: string;
};

const TOOL_DISPLAY_ZH: Record<string, string> = {
  execute_workflow: "执行工作流",
  render_document: "渲染交付文书",
  draft_document: "起草文书",
  research_task: "检索任务",
  update_draft: "更新草稿",
  send_email: "发送邮件",
  delegate_to_role: "委派给其他岗位",
  web_search: "联网检索",
};

export function toolDisplayNameZh(toolName: string): string {
  return TOOL_DISPLAY_ZH[toolName] ?? toolName;
}

/** Browser + Node safe (avoids `node:crypto` in Vite renderer bundles). */
function newRequiresActionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildThreadId(parts: {
  matterId?: string;
  taskId?: string;
  sessionId: string;
}): string {
  const m = parts.matterId?.trim() || "_";
  const t = parts.taskId?.trim() || "_";
  return `${m}:${t}:${parts.sessionId}`;
}

export function buildToolApprovalAction(input: {
  sessionId: string;
  matterId?: string;
  taskId?: string;
  toolName: string;
  toolCallId: string;
  toolArgs: Record<string, unknown>;
}): LawMindRequiresAction {
  const label = toolDisplayNameZh(input.toolName);
  return {
    id: newRequiresActionId(),
    kind: "tool_approval",
    threadId: buildThreadId(input),
    title: `待批准：${label}`,
    summary: `系统准备执行「${label}」。请确认后再继续，或选择暂不执行。`,
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    toolArgs: input.toolArgs,
    decisions: ["approve", "reject"],
    createdAt: new Date().toISOString(),
  };
}

export function buildClarificationAction(input: {
  sessionId: string;
  matterId?: string;
  taskId?: string;
  questions: ClarificationQuestion[];
}): LawMindRequiresAction {
  const n = input.questions.length;
  return {
    id: newRequiresActionId(),
    kind: "clarification",
    threadId: buildThreadId(input),
    title: n > 0 ? `待补充 ${n} 项信息` : "待您补充信息",
    summary:
      n > 0
        ? "请先回答下列问题，系统才能继续检索、起草或交付。"
        : "请先补充关键事实或材料，再发送下一条消息继续。",
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    clarificationQuestions: input.questions,
    decisions: ["respond"],
    createdAt: new Date().toISOString(),
  };
}

export function buildMatterApprovalAction(input: {
  sessionId?: string;
  matterId: string;
  approvalId: string;
  reason: string;
  matterLabel?: string;
}): LawMindRequiresAction {
  const label = input.matterLabel?.trim() || input.matterId;
  return {
    id: newRequiresActionId(),
    kind: "matter_approval",
    threadId: buildThreadId({
      matterId: input.matterId,
      sessionId: input.sessionId ?? "_",
    }),
    title: "待审批事项",
    summary: `${input.reason} — 需在案件「${label}」中处理。`,
    matterId: input.matterId,
    sessionId: input.sessionId,
    approvalId: input.approvalId,
    decisions: ["approve", "reject"],
    createdAt: new Date().toISOString(),
  };
}

/** Build requires-action list from a completed or interrupted turn. */
export function buildRequiresActionsFromTurn(
  turn: Pick<AgentTurn, "status" | "clarificationQuestions" | "turnId" | "sessionId"> & {
    pendingToolApproval?: {
      toolName: string;
      toolCallId: string;
      toolArgs: Record<string, unknown>;
    };
    matterId?: string;
  },
): LawMindRequiresAction[] {
  const out: LawMindRequiresAction[] = [];
  const base = {
    sessionId: turn.sessionId,
    matterId: turn.matterId,
    taskId: turn.turnId,
  };

  if (turn.status === "awaiting_clarification") {
    const qs = turn.clarificationQuestions ?? [];
    out.push(
      buildClarificationAction({
        ...base,
        questions: qs,
      }),
    );
  }

  if (turn.status === "awaiting_approval" && turn.pendingToolApproval) {
    out.push(
      buildToolApprovalAction({
        ...base,
        toolName: turn.pendingToolApproval.toolName,
        toolCallId: turn.pendingToolApproval.toolCallId,
        toolArgs: turn.pendingToolApproval.toolArgs,
      }),
    );
  }

  return out;
}

export function formatClarificationResumeMessage(
  answers: Record<string, string>,
  questions: ClarificationQuestion[],
): string {
  const lines: string[] = ["【补充信息】"];
  for (const q of questions) {
    const a = answers[q.key]?.trim();
    if (a) {
      lines.push(`${q.question}\n答：${a}`);
    }
  }
  if (lines.length === 1) {
    return "【补充信息】（律师已确认继续）";
  }
  return lines.join("\n\n");
}
