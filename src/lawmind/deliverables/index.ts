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
  specRequiresReasoningGraphAtDraft,
  validateReasoningAgainstSpec,
  validateReasoningForDraft,
  validateReasoningGraphAtDraft,
} from "./reasoning-validator.js";
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
export type { ReasoningGraphAtDraftReport } from "./reasoning-validator.js";
/**
 * Node-only workspace JSON loader lives in `./workspace-loader.js`.
 * Do not re-export it here — the desktop renderer imports this barrel, and
 * pulling `node:fs` into Vite client breaks the shell (blank page).
 */
export {
  assertChecklistCompleteForApprove,
  buildChecklistView,
  checkAllRequiredChecklistItems,
  emptyChecklistState,
  listVerificationChecklistSpecs,
  resolveVerificationChecklistSpec,
  type VerificationChecklistItemSpec,
  type VerificationChecklistSpec,
  type VerificationChecklistState,
  type VerificationChecklistView,
} from "./verification-checklist.js";
export {
  assessDeliverableReadiness,
  type DeliverableReadiness,
  type DeliverableReadinessBlocker,
} from "./deliverable-readiness.js";
