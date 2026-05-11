/**
 * LawMind 主入口（barrel）。
 *
 * `createLawMindEngine` 从 W1 起拆分到 `src/lawmind/engine/` 各子模块；
 * 本文件只做装配工厂的 re-export 与对外类型/工具的统一聚合，便于历史调用方
 * 继续用 `import { ... } from "lawmind"` / `from "./index.js"`。
 *
 * 链路（保持不变）：
 *   用户指令
 *     -> route()             Instruction Router
 *     -> [律师确认]          人工审核点 #1
 *     -> loadMemoryContext() Memory Layer
 *     -> retrieve()          Retrieval Layer
 *     -> [律师审核]          人工审核点 #2
 *     -> renderDocx()        Artifact Layer
 *     -> emit(audit)         Audit Layer
 */

export { createLawMindEngine } from "./engine/factory.js";
export type { LawMindEngine, LawMindEngineConfig } from "./engine/types.js";

// 重导出核心类型，方便外部直接从入口引用
export type {
  ArtifactDraft,
  BenchmarkResult,
  BenchmarkTask,
  LegalReasoningGraph,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  QualityRecord,
  ResearchBundle,
  ReviewLabel,
  TaskIntent,
} from "./types.js";
export { route, routeAsync } from "./router/index.js";
export {
  buildMatterIndex,
  buildMatterOverview,
  createMatterIfAbsent,
  listMatterIds,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
  isValidMatterId,
  parseOptionalMatterId,
} from "./cases/index.js";
export type { CreateMatterResult } from "./cases/index.js";
export {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
  clientProfileFilePath,
  ensureCaseWorkspace,
  ensureClientProfile,
  ensureFirmProfile,
  clausePlaybookPath,
  courtAndOpponentProfilePath,
  extractClientIdFromCaseMarkdown,
  ensureLawyerProfileSkeleton,
  loadMemoryContext,
  upsertMatterDisplayName,
} from "./memory/index.js";
export { createWorkspaceAdapter } from "./retrieval/index.js";
export { createGeneralModelAdapter, createLegalModelAdapter } from "./retrieval/model-adapters.js";
export { createOpenAICompatibleAdapters } from "./retrieval/openai-compatible.js";
export {
  createDomesticGeneralAdaptersFromEnv,
  createOpenSourceLegalAdaptersFromEnv,
  createLexEdgeAdapterFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "./retrieval/providers.js";
export {
  readAllAuditLogs,
  readAuditLog,
  buildAuditExportMarkdown,
  buildComplianceAuditMarkdown,
  filterAuditEventsForExport,
  formatAuditExportMarkdown,
  type AuditExportFilters,
} from "./audit/index.js";
export {
  deriveExecutionPlanSteps,
  deriveInstructionTitle,
  listTaskCheckpoints,
  listTaskRecords,
  persistAgentInstructionTask,
  readTaskRecord,
  taskIntentFromRecord,
  taskIntentFromRecordOnly,
  type TaskCheckpoint,
} from "./tasks/index.js";
export {
  listDrafts,
  readDraft,
  resolveDraftCitationIntegrity,
  validateDraftCitationsAgainstBundle,
  type CitationIntegrityResult,
  type DraftCitationIntegrityView,
} from "./drafts/index.js";
export {
  listBuiltInTemplates,
  listUploadedTemplates,
  registerUploadedTemplate,
  resolveTemplateForDraft,
  setUploadedTemplateEnabled,
  templateResolvedPin,
  type BuiltInTemplateCategory,
} from "./templates/index.js";
export {
  parseLawMindBundleManifest,
  verifyLawMindBundleManifest,
  type LawMindBundleEntryRole,
  type LawMindBundleManifest,
} from "./skills/index.js";

// Agent — 自主推理循环（第二代架构）
export { createLawMindAgent } from "./agent/index.js";
export type { LawMindAgent } from "./agent/index.js";
export type {
  AgentConfig,
  AgentModelConfig,
  AgentSession,
  AgentTurn,
  AgentTool,
  AgentContext,
} from "./agent/types.js";
export {
  readAssistantProfileMarkdown,
  appendAssistantProfileMarkdown,
  assistantProfilePath,
  buildReviewProfileLine,
  listAssistantProfileSections,
  type AssistantProfileSectionMeta,
} from "./assistants/profile-md.js";
export {
  buildDraft,
  buildDraftAsync,
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildDraftParams,
  type BuildLegalGraphParams,
} from "./reasoning/index.js";
export {
  buildBenchmarkReportMarkdown,
  benchmarkPassesThreshold,
  buildQualityDashboardMarkdown,
  buildQualityReportMarkdown,
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
  listGoldenTaskIds,
  listQualityRecords,
  persistQualityRecord,
  promoteGoldenExample,
  readQualityRecord,
  runBenchmarks,
  writeQualityDashboardJson,
  BUILTIN_BENCHMARK_TASKS,
} from "./evaluation/index.js";
export type { QualityDashboardJsonPayload } from "./evaluation/index.js";
export type {
  GoldenExampleEntry,
  GoldenPromoteResult,
  LawMindEngineForBenchmark,
} from "./evaluation/index.js";
export {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  buildGovernanceReportMarkdown,
  EDITION_FEATURES,
  EDITION_LABELS,
  evaluateBenchmarkGate,
  isFeatureEnabled,
  listEditions,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveEdition,
  workspacePolicyPath,
  type BenchmarkGateResult,
  type EditionContext,
  type EditionFeatureKey,
  type LawMindEdition,
  type LawMindWorkspacePolicy,
  type ResolvedAgentMandatoryRules,
} from "./policy/index.js";
export { buildAcceptancePackMarkdown } from "./delivery/acceptance-pack.js";
export {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  enqueueLearningSuggestion,
  listLearningSuggestions,
  type LearningSuggestionRecord,
} from "./learning/suggestion-queue.js";
export { applyReviewLabelsMemoryWrites } from "./learning/apply-review-labels.js";
export {
  contractRevisionsRootDir,
  finalizeContractRevisionPack,
  listContractRevisionPacks,
  resolvePathStrictlyUnderWorkspace,
  type ContractRevisionListItem,
  type ContractRevisionManifestV1,
  type FinalizeContractRevisionPackResult,
} from "./learning/contract-revision-pack.js";
export {
  readDeskSettings,
  writeDeskSettings,
  type LawmindDeskSettingsV1,
} from "./learning/desk-settings.js";
export {
  listOpenContractReviewDrafts,
  readContractReviewDraft,
  saveContractReviewDraft,
  markContractReviewDraftAccepted,
  type ContractReviewDraftV1,
} from "./learning/contract-review-draft.js";
export {
  appendClausePlaybookLearning,
  buildClausePlaybookReviewLine,
  buildAgentMemorySourceReport,
  CLAUSE_PLAYBOOK_RELATIVE,
  PLAYBOOK_REVIEW_SECTION,
  reviewLabelsTriggerPlaybook,
  toEngineClientMemorySnapshot,
  type EngineClientMemorySnapshot,
  type MemorySourceLayer,
} from "./memory/index.js";
export {
  ALL_REVIEW_LABELS,
  parseReviewLabels,
  REVIEW_LABEL_LEGACY_ENGLISH,
} from "./review-labels.js";
export {
  getAssistantPreset,
  listAssistantPresets,
  taskRiskExceedsPresetCeiling,
  type AssistantPresetDefinition,
} from "./agent/assistant-presets.js";
export {
  buildDeliverableFromDraft,
  buildApprovalRequestsFromMatterIndex,
  buildMatterFromIndex,
  buildMatterReadModelFromIndex,
  buildQueueItemsFromMatterIndex,
  type ApprovalRequest,
  type Deadline,
  type Deliverable,
  type DeliverableKind,
  type Matter,
  type MatterReadModel,
  type MatterStatus,
  type MemoryNode,
  type QueueKind,
  type WorkQueueItem,
} from "./core/contracts.js";
export {
  getMatterCockpitSummary,
  getMatterReadModel,
  listMatterCockpitOverviews,
  listMatterReadModels,
} from "./application/services/matter-service.js";
export { listApprovalRequests, listWorkQueueItems } from "./application/services/queue-service.js";

// Deliverable-First Architecture — spec registry + acceptance gate
export {
  BUILT_IN_DELIVERABLE_SPECS,
  getDeliverableSpec,
  isDraftReadyForRender,
  listDeliverableSpecs,
  validateDraftAgainstSpec,
  type AcceptanceCheck,
  type AcceptanceReport,
  type DeliverableSpec,
  type PlaceholderRule,
  type RequiredSection,
  type ValidateDraftFn,
  type ValidateDraftOptions,
} from "./deliverables/index.js";
