/**
 * Coordination tools — W8。
 *
 * 拆分自原 src/lawmind/agent/tools/collaboration-tools.ts（601 行）。
 * 子目录组织：
 *   - delegate.ts：delegate_task / delegate_to_role / list_delegations / get_delegation_result
 *   - handoff.ts：consult_assistant / request_review
 *   - meeting.ts：notify_assistant
 *   - utils.ts：共享 helpers
 */

export {
  createDelegateTaskTool,
  createDelegateToRoleTool,
  listDelegationsTool,
  getDelegationResultTool,
} from "./delegate.js";

export { createConsultAssistantTool, createRequestReviewTool } from "./handoff.js";

export { createNotifyAssistantTool } from "./meeting.js";
