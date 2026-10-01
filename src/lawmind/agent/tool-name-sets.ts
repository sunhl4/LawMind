/**
 * Tool name classification sets shared between:
 *   - governance metadata builder (`tools/governance.ts`)
 *   - runtime approval enforcement (`dangerous-tool-policy.ts`)
 *
 * Extracted to a leaf module so both can import it without a circular dependency
 * (governance.ts already imports `toolRequiresSubprocessSandbox` from
 * dangerous-tool-policy.ts; importing WRITE_TOOLS back from governance.ts would
 * close the cycle).
 *
 * WRITE_TOOLS drives the lawyer_approved_write classification (audit / runtime
 * mode). It does not pause the lawyer. 自 2026-10-01 起没有 disposition `pause`
 * 的工具：外发一律写入待发清单（inbox_signoff），回合不中断。
 */

/** 不可逆动作处置：pause 打断回合（当前无工具使用）；inbox_signoff 另需批准发送；deny_at_source 场景/工具内硬拒。 */
export type IrreversibleDisposition = "pause" | "inbox_signoff" | "deny_at_source";

/**
 * 不可逆动作默认集（借鉴评审 D10）。
 * 2026-10-01 起**没有 pause 工具**：外发（send_email）与 prepare_outbound_mail 一样
 * 只写入本案「待发信」，回合不中断；律师在待发列表点「批准发送」才真正发出
 * （approve_send 路由直接发送，不恢复回合）。`toolRequiresLawyerPause` 因此恒为
 * false，保留它只为让审批中间件与风险上限的调用点不必按名特判。
 */
export const IRREVERSIBLE_TOOLS: Readonly<Record<string, IrreversibleDisposition>> = {
  send_email: "inbox_signoff",
  prepare_outbound_mail: "inbox_signoff",
  delete_matter: "deny_at_source",
  render_document: "deny_at_source",
};

export function irreversibleDisposition(
  toolName?: string | null,
): IrreversibleDisposition | undefined {
  const n = toolName?.trim();
  return n ? IRREVERSIBLE_TOOLS[n] : undefined;
}

/** 审批卡「影响面」短句：按工具类别，不 dump 参数。 */
export function irreversibleImpactLabelZh(toolName?: string | null): string {
  const n = toolName?.trim() ?? "";
  const disposition = irreversibleDisposition(n);
  if (disposition === "pause") {
    return "不可逆外发：批准后会真正发出邮件";
  }
  if (disposition === "inbox_signoff" || n === "send_email" || n === "prepare_outbound_mail") {
    return "写入待发信：批准发送前不会发出";
  }
  if (n === "delete_matter") {
    return "不可逆删除：会删掉本案卷宗数据";
  }
  if (n === "render_document") {
    return "写入文书文件：可能覆盖或重建文稿";
  }
  if (n === "run_host_command") {
    return "本机命令：可能改动本机文件或状态";
  }
  if (n.startsWith("read_host") || n === "import_host_file") {
    return "读取本机文件：按你选择的授权范围";
  }
  return "执行后不能自动撤销已完成的动作";
}

export const MATTER_SCOPE_REQUIRED = new Set<string>([
  "search_matter",
  "read_case_file",
  "add_case_note",
  "get_matter_summary",
  "list_mail_inbox",
  "list_mail_attachments",
  "apply_legal_events",
  "compile_intake_brief",
  "apply_intake_brief",
  "update_matter_profile",
  "revert_desk_write",
  "propose_organize_plan",
  "execute_organize_plan",
  "relocate_matter_materials",
  "apply_file_ops",
  "delete_matter",
]);

export const BACKGROUND_JOB_TOOLS = new Set<string>(["execute_workflow"]);

export const IDEMPOTENT_READ_TOOLS = new Set<string>([
  "search_matter",
  "search_workspace",
  "search_conversations",
  "read_conversation",
  "read_project_file",
  "list_dir",
  "explore_folder",
  "read_folder_documents",
  "digest_materials",
  "search_host",
  "read_host_file",
  "search_statute",
  "search_case_law",
  "search_precedents",
  "get_matter_summary",
  "list_matters",
  "check_conflict_of_interest",
  "read_case_file",
  "analyze_document",
  "compare_documents",
  "list_tasks",
  "list_drafts",
  "get_audit_trail",
  "get_delegation_result",
  "list_delegations",
  "list_templates",
  "list_mail_inbox",
  "list_mail_attachments",
  "list_more_tools",
  "read_skill",
  "search_company_registry",
  "analyze_spreadsheet",
  "calculate",
  "web_search",
  "search_statute_web",
  "url_dossier",
  "extract_legal_events",
]);

/**
 * 工作台写穿工具（卷宗/期限/建案/归档）。对话里执行过其中任何一个，
 * 桌面端就应刷新案件管理列表与卷宗视图（renderer 也 import 这个集合）。
 */
export const DESK_WRITE_TOOL_NAMES = new Set<string>([
  "update_matter_profile",
  "create_matter",
  "apply_legal_events",
  "compile_intake_brief",
  "apply_intake_brief",
  "revert_desk_write",
  "record_deadline",
  "record_obligation",
  "add_case_note",
  "import_host_file",
  "relocate_matter_materials",
  "apply_file_ops",
  "delete_matter",
]);

export const WRITE_TOOLS = new Set<string>([
  "add_case_note",
  "write_document",
  "send_email",
  "prepare_outbound_mail",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_document",
  "render_tracked_draft",
  "execute_workflow",
  "request_review",
  "delegate_task",
  "delegate_to_role",
  "notify_assistant",
  "open_work_queue_item",
  "request_approval",
  "record_deadline",
  "record_obligation",
  "append_session_summary",
  "register_template",
  "set_template_enabled",
  "write_spreadsheet",
  "render_chart",
  "run_analysis",
  "run_compute",
  "import_host_file",
  "run_host_command",
  "apply_legal_events",
  "compile_intake_brief",
  "apply_intake_brief",
  "update_matter_profile",
  "revert_desk_write",
  "execute_organize_plan",
  "relocate_matter_materials",
  "apply_file_ops",
  "review_table_update",
  "create_matter",
  "delete_matter",
]);
