export {
  HABIT_MIN_OCCURRENCES,
  HISTORICAL_SCAN_SCHEMA,
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
  MAX_SCAN_ROOTS,
} from "./types.js";
export type {
  HistoricalCatalogItem,
  HistoricalDocKind,
  HistoricalHabitCandidate,
  HistoricalLayout,
  HistoricalScanCursor,
  HistoricalScanCursorFile,
  HistoricalScanJob,
  HistoricalScanRoot,
} from "./types.js";
export { classifyDocKind, classifyLayout, proposedMatterLabel } from "./classify.js";
export { extractHabitsFromRedlines, loadWorkspaceRedlineFiles } from "./habit-extract.js";
export {
  addScanRoot,
  listScanRoots,
  removeScanRoot,
  replaceWithCommonPlaces,
} from "./job-store.js";
export { applyScanPlan, buildScanPlan } from "./plan-placement.js";
export type { ScanPlan, ScanPlanSelection } from "./plan-placement.js";
export { fileScanIntoMatters } from "./file-into-matters.js";
export type { FileIntoMattersResult, FiledMatter, SkippedMatter } from "./file-into-matters.js";
export { readLatestScanJob, runHistoricalScan } from "./run-scan.js";
