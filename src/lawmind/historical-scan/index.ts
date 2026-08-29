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
export { addScanRoot, listScanRoots, removeScanRoot } from "./job-store.js";
export { readLatestScanJob, runHistoricalScan } from "./run-scan.js";
