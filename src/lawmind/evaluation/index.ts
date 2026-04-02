export {
  buildBenchmarkReportMarkdown,
  benchmarkPassesThreshold,
  runBenchmarks,
  BUILTIN_BENCHMARK_TASKS,
  type LawMindEngineForBenchmark,
} from "./benchmark.js";
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
