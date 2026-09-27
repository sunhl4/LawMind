export {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
  workspacePolicyPath,
  type LawMindWorkspacePolicy,
  type ResolvedAgentMandatoryRules,
} from "./workspace-policy.js";
export { evaluateBenchmarkGate, type BenchmarkGateResult } from "./benchmark-gate.js";
export { buildGovernanceReportMarkdown } from "./governance-report.js";
export {
  EDITION_FEATURES,
  EDITION_LABELS,
  EDITION_VALUES,
  featuresForEdition,
  isFeatureEnabled,
  isWordAddinAutoRunEnabled,
  listEditions,
  normalizeEdition,
  resolveEdition,
  resolveProductInsightsCollection,
  isProductInsightsCollectionEnabled,
  soloEditionFeatures,
  type EditionContext,
  type EditionFeatureKey,
  type LawMindEdition,
} from "./edition.js";
