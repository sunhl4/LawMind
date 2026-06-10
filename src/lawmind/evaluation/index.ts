export {
  buildBenchmarkReportMarkdown,
  benchmarkPassesThreshold,
  runBenchmarks,
  BUILTIN_BENCHMARK_TASKS,
  type LawMindEngineForBenchmark,
} from "./benchmark.js";
export type { BenchmarkResult, BenchmarkTask } from "../types.js";
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
  buildReleaseReadinessReportMarkdown,
  type ReleaseReadinessInput,
} from "./release-report.js";
