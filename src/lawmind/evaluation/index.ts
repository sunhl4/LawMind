export {
  buildBenchmarkReportMarkdown,
  benchmarkPassesThreshold,
  selectReleaseGateBenchmarkResults,
  runBenchmarks,
  BUILTIN_BENCHMARK_TASKS,
  type LawMindEngineForBenchmark,
} from "./benchmark.js";
export type { BenchmarkModelMode, BenchmarkResult, BenchmarkTask } from "../types.js";
export {
  buildQualityDashboardMarkdown,
  buildQualityReportMarkdown,
  listQualityRecords,
  persistQualityRecord,
  readQualityRecord,
} from "./quality.js";
export {
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
} from "./metrics.js";
export { listGoldenTaskIds, promoteGoldenExample } from "./golden.js";
export type { GoldenExampleEntry, GoldenPromoteResult } from "./golden.js";
export { writeQualityDashboardJson, type QualityDashboardJsonPayload } from "./export-json.js";
export {
  flushQualityDashboard,
  seedQualityAfterTask,
  seedQualitySnapshot,
} from "./quality-seed.js";
export {
  BUILTIN_LEGAL_REPLAY_FIXTURES,
  listReplayFixtureCategories,
  type LegalReplayFixture,
} from "./replay-fixtures.js";
export {
  BUILTIN_SHADOW_FIXTURES,
  defaultShadowModelScript,
  loadShadowFixtures,
  runShadowReplay,
  textOverlapRatio,
} from "./shadow-replay.js";
export {
  isShadowRealModelEnabled,
  runEngineShadowReplay,
  runEngineShadowReplayCase,
} from "./shadow-engine-replay.js";
export type {
  EngineShadowCaseResult,
  EngineShadowReplayOptions,
  EngineShadowReplayReport,
  EngineShadowReplaySummary,
} from "./shadow-engine-replay.js";
export {
  loadWorkspaceEngineShadowFixtures,
  loadWorkspaceShadowFixtures,
  runWorkspaceEngineShadowReplay,
  runWorkspaceShadowReplay,
} from "./closed-matter-shadow.js";
export {
  scoreLlmReviewAgreement,
  type LlmReviewAgreement,
  type LlmReviewLabel,
} from "./llm-review.js";
export type {
  ShadowModelScriptStep,
  ShadowReplayCaseResult,
  ShadowReplayFixture,
  ShadowReplayReport,
  ShadowReplaySummary,
} from "./shadow-replay.js";
export {
  buildReleaseReadinessReportMarkdown,
  type ReleaseReadinessInput,
} from "./release-report.js";
