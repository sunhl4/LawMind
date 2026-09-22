export type {
  StanceClauseTypeId,
  StanceEvidenceEntry,
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
  STANCE_SOURCE_WEIGHT,
  stanceConfidenceFromEvidence,
  upsertStanceFromKeyModification,
  upsertStanceFromRedline,
  writeStanceFromHabit,
} from "./capture.js";
export { formatStanceHint, selectInjectableStances } from "./inject.js";
export type { StanceInjectionContext, StanceInjectionSkip } from "./inject.js";
export { ensureFirmStanceDefaults } from "./firm-defaults.js";
export { stanceSelfCheck } from "./self-check.js";
