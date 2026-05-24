export type ApprovalTemplate =
  | "diff"
  | "readonly"
  | "acceptance"
  | "workflow"
  | "network"
  | "generic";

const WRITE_TOOLS = new Set([
  "write_document",
  "update_draft",
  "draft_document",
  "add_case_note",
  "open_work_queue_item",
  "request_approval",
  "record_deadline",
  "register_template",
]);

const READ_TOOLS = new Set([
  "read_project_file",
  "analyze_document",
  "search_workspace",
  "search_matter",
  "read_case_file",
  "get_matter_summary",
  "list_matters",
  "list_tasks",
  "list_drafts",
  "get_audit_trail",
]);

export function resolveApprovalTemplate(toolName: string): ApprovalTemplate {
  if (toolName === "render_document") {
    return "acceptance";
  }
  if (toolName === "execute_workflow") {
    return "workflow";
  }
  if (toolName === "web_search" || toolName === "search_statute_web") {
    return "network";
  }
  if (WRITE_TOOLS.has(toolName)) {
    return "diff";
  }
  if (READ_TOOLS.has(toolName)) {
    return "readonly";
  }
  return "generic";
}

export function approvalTemplateTitle(template: ApprovalTemplate): string {
  switch (template) {
    case "diff":
      return "写入/修改确认";
    case "readonly":
      return "只读访问确认";
    case "acceptance":
      return "渲染交付物确认";
    case "workflow":
      return "工作流执行确认";
    case "network":
      return "外联检索确认";
    default:
      return "工具执行确认";
  }
}
