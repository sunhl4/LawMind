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
 * Runtime enforcement MUST consult `WRITE_TOOLS` so that governance-classified
 * write tools require explicit `__approved: true` even when the individual tool
 * definition omits `requiresApproval: true` — keeping the two layers aligned by
 * construction instead of by convention.
 */

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
  "add_case_note",
  "import_host_file",
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
  "create_matter",
]);
