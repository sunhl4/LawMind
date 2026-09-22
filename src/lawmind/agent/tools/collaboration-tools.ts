/**
 * Inter-assistant collaboration tools — barrel re-export.
 *
 * W8：实现已拆到 `tools/coordination/` 子目录（delegate / handoff / meeting）。
 * 本文件保留为 re-export，以维持外部 import 路径稳定。
 *
 * 新增工具：
 *   - delegate_to_role：W8 起，按 Role 委派；优先使用此工具替代手填 assistantId。
 */

export {
  createDelegateTaskTool,
  createDelegateToRoleTool,
  createConsultAssistantTool,
  createNotifyAssistantTool,
  createRequestReviewTool,
  listDelegationsTool,
  getDelegationResultTool,
} from "./coordination/index.js";
