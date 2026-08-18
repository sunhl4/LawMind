/**
 * Matter views — W11。
 *
 * 6 个视图组件（cockpit / review-queue / memory / reasoning / quality / role）
 * + 3 个 insights 子组件（feed / convergence / experiments）。
 *
 * MatterWorkbench 的目标形态：tab 容器 + 路由这些视图，单文件 < 300 行。
 * 当前 PR 仅完成"组件 seam + 黄金路径 e2e"，正式迁入由后续 PR 渐进完成
 * （详见 docs/lawmind/refactor-blueprint.md）。
 */

export { MatterCockpit } from "./MatterCockpit";
export { MatterReviewQueuePanel } from "./MatterReviewQueuePanel";
export type { ReviewQueueRow, ApprovalRow } from "./MatterReviewQueuePanel";
export {
  DraftAcceptanceBadge,
  DraftCitationBadge,
  MatterTasksPanel,
} from "./MatterTasksPanel";
export type { AcceptanceSummaryItem } from "./MatterTasksPanel";
export { MatterMemoryInspector } from "./MatterMemoryInspector";
export { MatterReasoningBoard } from "./MatterReasoningBoard";
export { MatterQualityCockpit } from "./MatterQualityCockpit";
export { MatterRoleBoard } from "./MatterRoleBoard";
export type { RoleAssignmentRow } from "./MatterRoleBoard";
export {
  InteractionConvergence,
  LawyerActionFeed,
  ProductExperiments,
} from "./insights/index.js";
