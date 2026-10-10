/**
 * Word tracked-change document model. One run sequence per paragraph; no
 * parallel LawMind hunk type. Colors are not stored in the file.
 */

import type { WordRunMark } from "../word-surface-layout.js";

export type { WordRunMark };

export type WordMarkupMode = "all" | "simple" | "none" | "original";

export type WordTrackKind = "ins" | "del" | "moveFrom" | "moveTo" | "format";

export type WordRevisionDisposition = "open" | "accepted";

export type WordRevisionTrack = {
  kind: WordTrackKind;
  id: string;
  author: string;
  date?: string;
  moveName?: string;
  /** Balloon text for a formatting revision, e.g. 「加粗」. */
  format?: string;
  /** LawMind fold. Absent or open stays expanded. Accepted stays a Word track. */
  disposition?: WordRevisionDisposition;
};

/** Object-replacement placeholder for a non-text preserved run (drawing/field). */
export const WORD_PRESERVED_RUN_CHAR = "\uFFFC";

export type WordRevisionRun = {
  text: string;
  track?: WordRevisionTrack;
  mark?: WordRunMark;
  commentIds?: string[];
  /**
   * Full `<w:r>…</w:r>` written back as-is by serializeRuns.
   * When set, `text` is typically {@link WORD_PRESERVED_RUN_CHAR}.
   */
  preservedXml?: string;
  /** Optional preview for a preserved drawing run. */
  image?: { src: string; widthPx?: number; heightPx?: number };
};

export type ComposeAuthor = {
  name: string;
  now: string;
  nextId: () => string;
};

export type WordRevisionComment = {
  commentId: string;
  author: string;
  date?: string;
  body: string;
  anchorText: string;
};

export type WordRevisionBalloon = {
  revId: string;
  change: WordTrackKind;
  author: string;
  text: string;
  date?: string;
  color: number;
  format?: string;
  disposition?: WordRevisionDisposition;
};

export type WordRevisionAtom = {
  ch: string;
  track?: WordRevisionTrack;
  mark?: WordRunMark;
  commentIds?: string[];
  preservedXml?: string;
};
