export type {
  StanceClauseTypeId,
  StanceFamily,
  StanceItem,
  StanceRedlineHunk,
  StanceSource,
  StanceStoreFile,
} from "./types.js";
export { STANCE_CLAUSE_TYPE_IDS, STANCE_SCHEMA_VERSION } from "./types.js";
export { mutateStanceItems, readStanceItems, stanceItemsPath, writeStanceItems } from "./store.js";
export {
  captureStanceFromRedline,
  detectStanceClauseType,
  normalizeStanceLanguage,
  parseHabitStancePayload,
  stanceConfidence,
  upsertStanceFromRedline,
  writeStanceFromHabit,
} from "./capture.js";
export { formatStanceHint } from "./inject.js";
