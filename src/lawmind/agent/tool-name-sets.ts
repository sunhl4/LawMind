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
]);

export const BACKGROUND_JOB_TOOLS = new Set<string>(["execute_workflow"]);

export const IDEMPOTENT_READ_TOOLS = new Set<string>([
  "search_matter",
  "search_workspace",
  "read_project_file",
  "search_statute",
  "search_case_law",
  "get_matter_summary",
  "list_matters",
  "check_conflict_of_interest",
  "read_case_file",
  "analyze_document",
  "list_tasks",
  "list_drafts",
  "get_audit_trail",
  "get_delegation_result",
  "list_delegations",
  "list_templates",
]);

export const WRITE_TOOLS = new Set<string>([
  "add_case_note",
  "write_document",
  "send_email",
  "draft_document",
  "update_draft",
  "render_document",
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
]);
