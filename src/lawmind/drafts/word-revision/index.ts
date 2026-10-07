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
  replaceRange,
  sameTrack,
} from "./compose.js";
export { parseCommentsXml, serializeCommentsXml } from "./comments.js";
export {
  DISPOSITION_PART,
  acceptedIdsInRuns,
  nextDispositionIds,
  parseDispositionXml,
  serializeDispositionXml,
  trackIdsInDocumentXml,
  withAcceptedDisposition,
} from "./disposition.js";
export { materializeHunks } from "./materialize.js";
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
  paragraphHasMarkup,
  projectRuns,
} from "./view.js";
export { replaceParagraphRunsInXml, serializeRuns } from "./xml.js";
