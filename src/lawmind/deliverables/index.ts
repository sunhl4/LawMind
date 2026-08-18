/**
 * Deliverable-First Architecture — public entrypoint.
 *
 * 把"交付物"作为一等公民暴露给：
 *   - engine（render 前调用 validateDraftAgainstSpec 做 acceptance gate）
 *   - agent（draft_document 工具结果可附 acceptance report）
 *   - desktop（审核台/案件 cockpit 显示验收清单）
 *
 * 详见 docs/LAWMIND-DELIVERABLE-FIRST.md。
 */

export {
  BUILT_IN_DELIVERABLE_SPECS,
  clearExtraDeliverableSpecs,
  getDeliverableSpec,
  listDeliverableSpecs,
  listExtraDeliverableSpecs,
  registerExtraDeliverableSpecs,
} from "./registry.js";
export { isDraftReadyForRender, validateDraftAgainstSpec } from "./validator.js";
export { countPlaceholderLikeMarkers, heuristicPlaceholderRatio } from "./draft-sanity.js";
export {
  countScaffoldPlaceholdersInDraft,
  EXPLICIT_TODO_PLACEHOLDER,
  findScaffoldPlaceholders,
  isHighScaffoldDensity,
  isScaffoldFieldLabel,
} from "./placeholder-pattern.js";
export { validateReasoningAgainstSpec, validateReasoningForDraft } from "./reasoning-validator.js";
export type {
  AcceptanceCheck,
  AcceptanceReport,
  DeliverableSpec,
  PlaceholderRule,
  ReasoningCheck,
  ReasoningGateSpec,
  ReasoningReport,
  RequiredSection,
  ValidateDraftFn,
  ValidateDraftOptions,
} from "./types.js";
export { loadWorkspaceDeliverableSpecs, parseDeliverableSpec } from "./workspace-loader.js";
export type { WorkspaceSpecLoadResult, WorkspaceSpecWarning } from "./workspace-loader.js";
