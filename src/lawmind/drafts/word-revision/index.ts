export { WORD_REVISION_COLOR_COUNT, assignAuthorColors, rememberAuthor } from "./color.js";
export {
  allMarkupText,
  coalesceRuns,
  decideRuns,
  deleteBackward,
  deleteForward,
  applyFormatRange,
  attachComment,
  finalOffsetToAll,
  finalText,
  flattenRuns,
  insertText,
  inspectRuns,
  isDeletion,
  isInsertion,
  makeAuthorClock,
  maxTrackId,
  moveRange,
  originalOffsetToAll,
  originalText,
  replacePlain,
  replaceRange,
  sameTrack,
} from "./compose.js";
export { parseCommentsXml, serializeCommentsXml } from "./comments.js";
export {
  DISPOSITION_PART,
  acceptedIdsInRuns,
  nextDispositionIds,
  nextTrackHunks,
  parseDispositionPart,
  parseDispositionXml,
  serializeDispositionXml,
  trackIdsInDocumentXml,
  withAcceptedDisposition,
} from "./disposition.js";
export { materializeHunks } from "./materialize.js";
export {
  compareRevisionPreservation,
  describeInsertionEdits,
  describeRenumbered,
  explainRevisionPreservation,
  REVISION_PRESERVATION_FAILED_CODE,
  snapshotDocumentRevisions,
  type RevisionAlteration,
  type RevisionFingerprint,
  type RevisionKind,
  type RevisionPreservation,
} from "./preservation.js";
// File-I/O helpers live in preservation-file.ts; keep this renderer-facing barrel pure.
export type { DocxRevisionPreservation } from "./preservation-file.js";
export type {
  ComposeAuthor,
  WordMarkupMode,
  WordRevisionAtom,
  WordRevisionBalloon,
  WordRevisionComment,
  WordRevisionDisposition,
  WordRevisionRun,
  WordRevisionTrack,
  WordTrackKind,
} from "./types.js";
export {
  collectAuthors,
  collectBalloons,
  colorsForRuns,
  contiguousGroupKeys,
  paragraphHasMarkup,
  projectRuns,
} from "./view.js";
export { insertEmptyTableRowInXml, replaceParagraphRunsInXml, serializeRuns } from "./xml.js";
