export {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
  workspacePolicyPath,
  type LawMindEdition,
  type LawMindWorkspacePolicy,
  type ResolvedAgentMandatoryRules,
} from "./workspace-policy.js";
export { evaluateBenchmarkGate, type BenchmarkGateResult } from "./benchmark-gate.js";
export { buildGovernanceReportMarkdown } from "./governance-report.js";
export {
  EDITION_FEATURES,
  EDITION_LABELS,
  isFeatureEnabled,
  listEditions,
  resolveEdition,
  type EditionContext,
  type EditionFeatureKey,
} from "./edition.js";
