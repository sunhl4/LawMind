/**
 * Unified interrupt / resume payload for clarification, tool approval, and matter approvals.
 * Aligns with docs/archive/LAWMIND-INTERRUPT-RESUME.md (LangGraph-style human-in-the-loop).
 */

import type { AgentTurn } from "../agent/types.js";
import type { ClarificationQuestion } from "../types.js";
import { extractApprovalDocumentPreview } from "./tool-approval-diff.js";

export type LawMindRequiresActionKind =
  | "clarification"
  | "tool_approval"
  | "matter_approval"
  | "workflow_blocked"
  | "continue_tools";

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
  /** Soft-budget checkpoint: tools already used this thread (continue_tools). */
  toolCallsExecuted?: number;
  decisions: LawMindRequiresActionDecision[];
  createdAt: string;
  /** Escalate hint, e.g. outbound mail: 先核对收件人再发 */
  recommendation?: string;
  rationale?: string;
  riskFlags?: string[];
  /** Never true for send_email / outbound. */
  readyToUse?: boolean;
};

export type ResumeRequiresActionInput = {
  sessionId: string;
  actionId: string;
  decision: LawMindRequiresActionDecision;
  editedArgs?: Record<string, unknown>;
  clarificationAnswers?: Record<string, string>;
  resolvedBy?: string;
};

/** Lawyer-facing labels — never show eng_snake tool ids in UI copy. */
const TOOL_DISPLAY_ZH: Record<string, string> = {
  execute_workflow: "启动办案流程",
  render_document: "生成 Word 文书",
  draft_document: "起草文书",
  research_task: "法规检索",
  update_draft: "更新草稿",
  apply_surgical_edits: "按词修订",
  write_document: "审定文书",
  send_email: "发送邮件",
  prepare_outbound_mail: "准备外发邮件",
  list_mail_inbox: "查看邮件匣",
  list_mail_attachments: "查看邮件附件",
  render_tracked_draft: "生成审阅痕迹稿",
  delegate_task: "交办事项",
  delegate_to_role: "交办给同事",
  web_search: "联网检索",
  search_statute_web: "检索法规",
  search_statute: "检索法条",
  search_case_law: "检索案例",
  search_workspace: "检索案卷材料",
  search_matter: "检索本案材料",
  read_project_file: "查阅项目文件",
  read_case_file: "查阅案卷",
  analyze_document: "分析文书",
  compare_documents: "对比文本",
  plan_task: "安排办理步骤",
  request_approval: "提请审批",
  request_review: "提请复核",
  record_deadline: "登记期限",
  list_tasks: "查看事项清单",
  list_drafts: "查看草稿清单",
  list_matters: "查看案件列表",
  list_delegations: "查看交办",
  get_delegation_result: "查看交办结果",
  get_matter_summary: "查看案件摘要",
  get_audit_trail: "查看办理记录",
  add_case_note: "添加案件备注",
  consult_assistant: "征询同事意见",
  notify_assistant: "通知同事",
  open_work_queue_item: "打开待办事项",
  append_session_summary: "整理会话摘要",
  register_template: "登记模板",
  list_templates: "查看模板",
  set_template_enabled: "启用/停用模板",
  check_conflict_of_interest: "利益冲突检索",
  list_more_tools: "更多能力",
};

const SNAKE_TOOL_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

const OUTBOUND_MAIL_TOOLS = new Set(["send_email", "prepare_outbound_mail"]);

function outboundMailEscalateFields(
  toolName: string,
):
  | Pick<LawMindRequiresAction, "recommendation" | "rationale" | "riskFlags" | "readyToUse">
  | undefined {
  if (!OUTBOUND_MAIL_TOOLS.has(toolName)) {
    return undefined;
  }
  return {
    recommendation: "先核对收件人再发",
    rationale: "外发前请核对收件人、正文与附件。系统不会自动发送。",
    riskFlags: ["outbound"],
    readyToUse: false,
  };
}

export function toolDisplayNameZh(toolName: string): string {
  const key = toolName.trim();
  if (!key) {
    return "该项操作";
  }
  if (TOOL_DISPLAY_ZH[key]) {
    return TOOL_DISPLAY_ZH[key];
  }
  // Never surface programmer identifiers (e.g. write_document) in lawyer UI.
  if (SNAKE_TOOL_RE.test(key)) {
    return "该项操作";
  }
  return key;
}

/** Replace known eng tool ids / jargon inside titles / summaries for display. */
export function sanitizeLawyerFacingText(text: string, toolName?: string | null): string {
  let out = text;
  if (toolName?.trim()) {
    const raw = toolName.trim();
    const label = toolDisplayNameZh(raw);
    if (out.includes(raw)) {
      out = out.split(raw).join(label);
    }
  }
  out = out.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m) => TOOL_DISPLAY_ZH[m] ?? "相关操作");
  out = out.replace(/\[协作\]\s*/g, "协作 · ");
  out = out.replace(/\bdelegate\b/gi, "交办");
  out = out.replace(/\bdefault\b/gi, "默认协办");
  out = out.replace(/委派子会话/g, "协作会话");
  out = out.replace(/协作\s*·\s*交办(?:\s*·\s*默认协办)?/g, "协作交办");
  out = out.replace(/\s*·\s*默认协办/g, "");
  out = out.replace(/\bdrafts\/[^\s]+/gi, "草稿");
  out = out.replace(/\.(md|json|docx)\b/gi, "");
  out = out.replace(/待批准：\s*审定文书/g, "待审定文书");
  out = out.replace(/待批准：\s*写入文书/g, "待审定文书");
  out = out.replace(/写入文书/g, "待审定文书");
  out = out.replace(/系统准备执行/g, "拟进行");
  out = out.replace(/暂不执行/g, "暂不办理");
  return out.replace(/\s{2,}/g, " ").trim();
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
  const preview = extractApprovalDocumentPreview(input.toolArgs);
  const title = preview?.title
    ? `待审定：${preview.title}`
    : input.toolName === "write_document" || input.toolName === "update_draft"
      ? "待审定文书"
      : `待批准：${label}`;
  const summary = preview
    ? "请通读拟落稿全文后决定是否批准。"
    : `拟进行「${label}」。请确认后再继续，或选择暂不办理。`;
  return {
    id: newRequiresActionId(),
    kind: "tool_approval",
    threadId: buildThreadId(input),
    title,
    summary,
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    toolArgs: input.toolArgs,
    decisions: ["approve", "reject"],
    createdAt: new Date().toISOString(),
    ...outboundMailEscalateFields(input.toolName),
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

export function buildContinueToolsAction(input: {
  sessionId: string;
  matterId?: string;
  taskId?: string;
  used?: number;
}): LawMindRequiresAction {
  const used = input.used && input.used > 0 ? input.used : undefined;
  return {
    id: newRequiresActionId(),
    kind: "continue_tools",
    threadId: buildThreadId(input),
    title: "本轮步骤较多",
    summary: used
      ? `已经办理 ${used} 步。继续，还是先停在这里？`
      : "本轮步骤较多。继续，还是先停在这里？",
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    toolCallsExecuted: used,
    decisions: ["approve", "reject"],
    createdAt: new Date().toISOString(),
  };
}

/** Build requires-action list from a completed or interrupted turn. */
export function buildRequiresActionsFromTurn(
  turn: Pick<AgentTurn, "status" | "clarificationQuestions" | "turnId" | "sessionId"> & {
    toolCallsExecuted?: number;
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

  if (turn.status === "paused") {
    out.push(
      buildContinueToolsAction({
        ...base,
        used: turn.toolCallsExecuted,
      }),
    );
  }

  return out;
}

export { formatClarificationResumeMessage } from "./clarification-fields.js";
