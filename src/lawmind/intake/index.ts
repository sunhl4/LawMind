export * from "./types.js";
export {
  findIntakeItemId,
  getIntakeItem,
  intakeItemFullText,
  intakeRoot,
  isIntakeItemId,
  listIntakeItems,
  readIntakeBlob,
  readIntakeEvents,
  readIntakeState,
  recordIntakeItem,
  rememberIntakeThreadRef,
} from "./store.js";
export {
  extractBracketRefs,
  normalizeCaseNoForMatch,
  resolveIntakeItem,
  type IntakeMatterIndex,
  type IntakeMatterProfile,
} from "./resolve.js";
export { buildIntakeMatterIndex } from "./matter-index.js";
export {
  evaluateIntakeMatching,
  type MatchingEvalCase,
  type MatchingEvalReport,
  type MatchingEvalRow,
} from "./matching-eval.js";
export {
  collectLawyerMatchingCases,
  evaluateWorkspaceMatching,
  type MatchingLabelSource,
  type WorkspaceMatchingEval,
} from "./matching-labels.js";
export {
  attachIntakeItem,
  detachIntakeItem,
  ignoreIntakeItem,
  restoreIntakeItem,
  type IntakeFilingError,
  type IntakeFilingResult,
} from "./filing.js";
export {
  acceptIntakeLead,
  intakeLeadStageLabel,
  setIntakeLeadStage,
  type IntakeLeadError,
  type IntakeLeadResult,
} from "./lead.js";
export {
  ADMISSION_ID_RE,
  AdmissionCandidateSchema,
  AdmissionConflictHitSchema,
  AdmissionConflictSchema,
  AdmissionDecisionSchema,
  AdmissionDisclosureSchema,
  AdmissionRecordSchema,
  AdmissionStatusSchema,
  AdmissionTimelineEntrySchema,
  acknowledgeAdmissionDisclosures,
  addAdmissionCandidates,
  admissionCandidatesFromItem,
  admissionGateMessage,
  admissionPath,
  admissionRoot,
  assignAdmissionOwner,
  beginConflictScan,
  checkAdmissionGate,
  createAdmission,
  decideAdmission,
  listAdmissions,
  loadAdmission,
  recordConflictScan,
  type AdmissionCandidate,
  type AdmissionConflict,
  type AdmissionConflictHit,
  type AdmissionDecision,
  type AdmissionError,
  type AdmissionGate,
  type AdmissionGateReason,
  type AdmissionRecord,
  type AdmissionResult,
  type AdmissionStatus,
  type AdmissionTimelineEntry,
} from "./admission.js";
export {
  scanAdmissionConflicts,
  scanConflictOfInterest,
  type ConflictScanOutcome,
  type ConflictScanResult,
} from "./conflict-scan.js";
export {
  ENGAGEMENT_DIRNAME,
  EngagementPackageInputSchema,
  engagementPackageDir,
  loadEngagementPackage,
  writeEngagementPackage,
  type EngagementPackageError,
  type EngagementPackageFile,
  type EngagementPackageInput,
  type EngagementPackageManifest,
  type EngagementPackageResult,
} from "./engagement-package.js";
export {
  engagementMarkdownToDraft,
  exportEngagementPackageDocx,
  type EngagementDocxError,
  type EngagementDocxResult,
} from "./engagement-package-docx.js";
export {
  FIELD_LABELS,
  MATTER_PROVENANCE_FIELDS,
  MatterProvenanceFieldSchema,
  applyIntakeFieldProvenance,
  applyIntakeFieldsFromItem,
  extractIntakeMatterFields,
  listMissingProvenance,
  loadFieldProvenance,
  provenancePath,
  provenanceRoot,
  type FieldProvenanceEntry,
  type FieldProvenanceFile,
  type MatterProvenanceField,
  type ProvenanceApplyResult,
  type ProvenanceCoverage,
} from "./field-provenance.js";
export { retriageUnfiledIntake, triageIntakeItem } from "./triage.js";
export {
  listIntakeMailAccounts,
  syncIntakeMailbox,
  type IntakeMailFetch,
  type IntakeMailSyncResult,
} from "./mail-intake.js";
export {
  ensureIntakeDropzone,
  INTAKE_DROPZONE_DIRNAME,
  INTAKE_WECOM_DIRNAME,
  intakeDropzoneDir,
  scanIntakeDropzone,
  type DropzoneScanResult,
} from "./dropzone.js";
export {
  ensureWecomArchiveDir,
  parseWecomArchive,
  scanWecomArchive,
  toIntakeItemInput,
  wecomArchiveDir,
  type WecomArchive,
  type WecomMessage,
  type WecomScanResult,
} from "./wecom-archive.js";
export { INTAKE_MAIL_POLL_MS, runIntakeTick, type IntakeTickResult } from "./tick.js";
export {
  INTAKE_AUDIO_EXTENSIONS,
  MAX_ASR_INPUT_BYTES,
  asrSegmentsFromResponse,
  asrTranscriptFromResponse,
  isIntakeAudioFile,
  isTranscriptionEligible,
  readAsrConfig,
  setIntakeTranscriptSegmentText,
  setIntakeTranscriptSpeakerLabel,
  setIntakeTranscriptSpeakerParty,
  transcribeIntakeRecording,
  type AsrConfig,
  type SegmentTextResult,
  type SpeakerLabelResult,
  type SpeakerPartyResult,
  type TranscribeReason,
  type TranscribeResult,
} from "./recording.js";
