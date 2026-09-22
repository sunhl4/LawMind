export type {
  LawyerWork,
  LawyerWorkEvent,
  LawyerWorkSource,
  LawyerWorkStatus,
  LawyerWorkUpsertInput,
} from "./types.js";
export {
  appendWorkEvent,
  createLawyerWork,
  findLawyerWork,
  listLawyerWorks,
  mergeWorkStatus,
  readLawyerWork,
  upsertLawyerWork,
  upsertLawyerWorkFromPersist,
  workEventsPath,
  workRecordPath,
  worksDir,
  writeLawyerWork,
} from "./store.js";
export { searchLawyerWorks, type LawyerWorkSearchHit } from "./search.js";
export {
  applyClaimedWorkGoalToHistory,
  claimAndApplyWorkGoal,
  claimPendingWorkGoal,
  ensureLawyerWorkForTurn,
  formatWorkGoalUserMessage,
  goalFromInstruction,
  normalizeWorkGoal,
  queueWorkGoal,
  setLawyerWorkGoal,
} from "./goal.js";
