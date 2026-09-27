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
  | "judgment_escalation"
  | "continue_tools";

export type LawMindRequiresActionDecision = "approve" | "edit" | "reject" | "respond";

/** `continue_tools` 的两种来源（见 turn-interrupt.ts）。 */
export type ContinueToolsTrigger = "step_budget" | "interrupted";

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
  /** Legacy / same-turn-verify pause: tools already used this thread (continue_tools). */
  toolCallsExecuted?: number;
  /**
   * `continue_tools` 的来源：步骤预算用尽（旧行为）或上一轮被中断（Codex 对齐）。
   * 中断卡片要进对话线索并给出「继续本件 / 弃办」，预算卡片只进在办。
   */
  trigger?: ContinueToolsTrigger;
  /** 中断轮次的原指令，恢复时带出让模型接着办同一件事。 */
  instruction?: string;
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
  search_conversations: "检索其他对话",
  read_conversation: "阅读历史对话",
  search_matter: "检索本案材料",
  read_project_file: "查阅项目文件",
  list_dir: "列举目录",
  explore_folder: "探查文件夹",
  digest_materials: "分头读材料",
  draft_worker: "起草片段",
  search_host: "本机查找",
  read_host_file: "阅读本机文件",
  import_host_file: "收进本案",
  run_host_command: "本机命令",
  read_case_file: "查阅案卷",
  analyze_document: "分析文书",
  compare_documents: "对比文本",
  plan_task: "安排办理步骤",
  update_plan: "本轮步骤",
  request_approval: "提请审批",
  request_review: "提请复核",
  record_deadline: "登记期限",
  record_obligation: "登记义务",
  extract_legal_events: "抽出期限",
  apply_legal_events: "写入期限",
  compile_intake_brief: "整理谈话",
  apply_intake_brief: "写入谈话档案",
  update_matter_profile: "更新卷宗",
  revert_desk_write: "撤销刚才写入",
  relocate_matter_materials: "归位材料",
  apply_file_ops: "整理文件",
  create_matter: "新建案件",
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
  read_skill: "读取技能",
  search_company_registry: "企业登记查询",
  analyze_spreadsheet: "分析表格",
  write_spreadsheet: "生成表格",
  render_chart: "出图",
  calculate: "法律计算",
  run_compute: "核算数据",
  run_analysis: "核算数据",
};

export const HOST_GRANT_TOOL_NAMES = new Set(["read_host_file", "import_host_file"]);

export function isHostGrantToolName(name?: string | null): boolean {
  const n = name?.trim();
  return Boolean(n && HOST_GRANT_TOOL_NAMES.has(n));
}

export function hostGrantEditedArgs(
  toolArgs: Record<string, unknown> | undefined,
  duration: "once" | "session" | "always",
): Record<string, unknown> {
  return { ...toolArgs, grant_duration: duration };
}

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
    : isHostGrantToolName(input.toolName)
      ? `拟进行「${label}」。请选择允许一次、本会话允许或始终允许；拒绝则不读该文件。`
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
  trigger?: ContinueToolsTrigger;
}): LawMindRequiresAction {
  const used = input.used && input.used > 0 ? input.used : undefined;
  const trigger = input.trigger ?? "step_budget";
  return {
    id: newRequiresActionId(),
    kind: "continue_tools",
    threadId: buildThreadId(input),
    title: trigger === "interrupted" ? "上一轮被中断" : "本轮步骤较多",
    summary:
      trigger === "interrupted"
        ? "已办理的步骤保留。继续本件，还是先弃办？"
        : used
          ? `已经办理 ${used} 步。继续，还是先停在这里？`
          : "本轮步骤较多。继续，还是先停在这里？",
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    toolCallsExecuted: used,
    trigger,
    decisions: ["approve", "reject"],
    createdAt: new Date().toISOString(),
  };
}

/**
 * 门禁把本件停下（独立审稿轮次用尽等）：缺口进律师待办，点一下确认即收起。
 * 用 `respond` 作为唯一决定，避免与「批准/驳回」语义混淆。
 */
export function buildWorkflowBlockedAction(input: {
  sessionId: string;
  matterId?: string;
  taskId?: string;
  stop: { reason?: string; gaps?: string[]; codes?: string[] };
}): LawMindRequiresAction {
  const gaps = (input.stop.gaps ?? []).filter((g) => g.trim().length > 0);
  const lines =
    gaps.length > 0 ? gaps.map((g) => `- ${g}`) : input.stop.reason ? [input.stop.reason] : [];
  return {
    id: newRequiresActionId(),
    kind: "workflow_blocked",
    threadId: buildThreadId(input),
    title: "改稿缺口待您处置",
    summary: [
      "验证器已把本件停下（继续为过审改稿没有意义），缺口需要您处置：",
      ...lines,
      "",
      "处置后可以让我接着改，或另出意见书。",
    ].join("\n"),
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    decisions: ["respond"],
    createdAt: new Date().toISOString(),
  };
}

/**
 * G3：判断项升级卡 —— 需要律师定夺的**主观裁量项**（`tier: "lawyer"`）。
 *
 * 为什么需要它：判据分级把检查单项分成 machine / judge / lawyer。`lawyer` 项的定义是
 * **「不判，只升级」**——`LAWMIND-LEGAL-COMPILER-ROADMAP.md` §2.3 的口径是
 * 「主观裁量项永不编译」。但"只升级"要有**升级的去处**，否则这些项会从提示词里
 * 安静消失（`isLawyerEscalationAvailable()` 存在的理由，见 `policy/judgment-tiering.ts`）。
 *
 * 文案纪律（见 `AGENTS.md` 与 UI 禁词表）：
 *   - 只说**要您定夺什么**，不替律师决定；
 *   - **不出现**判定项内部 id、模型名、概率数字、工程师术语；
 *   - `decisions` 固定 `["respond", "edit"]`——这是"请您拍板"，不是"批准/驳回"。
 */
export function buildJudgmentEscalationAction(input: {
  sessionId: string;
  matterId?: string;
  taskId?: string;
  /** 律师可读的待定夺条目（已由调用方转成中文业务语言）。 */
  items: Array<{ label: string; why?: string }>;
  /** 本次机械核对覆盖自述（诚实呈现，I12）。 */
  coverageNote?: string;
}): LawMindRequiresAction | undefined {
  const items = input.items.filter((i) => i.label.trim().length > 0);
  if (items.length === 0) {
    return undefined;
  }
  const lines: string[] = [`本件有 ${items.length} 处属商业取舍或办案策略，系统不代为决定：`];
  for (const item of items.slice(0, 8)) {
    lines.push(item.why ? `- ${item.label}（${item.why}）` : `- ${item.label}`);
  }
  if (items.length > 8) {
    lines.push(`- 另有 ${items.length - 8} 处，详见审核台。`);
  }
  lines.push("");
  lines.push("请确认按哪种口径办理；在此之前，系统不会替您选一条路继续。");
  if (input.coverageNote?.trim()) {
    lines.push("");
    lines.push(input.coverageNote.trim());
  }
  return {
    id: newRequiresActionId(),
    kind: "judgment_escalation",
    threadId: buildThreadId(input),
    title: "本件有事项需您定夺",
    summary: lines.join("\n"),
    matterId: input.matterId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    decisions: ["respond", "edit"],
    recommendation: "请确认按哪种口径办理",
    rationale:
      "这些事项取决于商业取舍或办案策略，不同律师会给出不同答案；系统只把它们摆出来，不代为选择。",
    riskFlags: ["judgment_escalation"],
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
    /** 门禁把本件停下（见 platform/gate-stop.ts）：缺口要进律师待办。 */
    gateStop?: { reason?: string; gaps?: string[]; codes?: string[] };
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

  if (turn.status === "paused" || turn.status === "interrupted") {
    out.push(
      buildContinueToolsAction({
        ...base,
        used: turn.toolCallsExecuted,
        ...(turn.status === "interrupted" ? { trigger: "interrupted" as const } : {}),
      }),
    );
  }

  if (turn.gateStop) {
    out.push(buildWorkflowBlockedAction({ ...base, stop: turn.gateStop }));
  }

  return out;
}

export { formatClarificationResumeMessage } from "./clarification-fields.js";
