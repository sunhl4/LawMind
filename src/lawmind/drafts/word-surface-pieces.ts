/**
 * Browser-safe revision fragments for the desktop Word preview.
 * `word-surface.ts` reads files and imports `node:crypto`; a value import of
 * that module crashes the window on load.
 */

import { computeMinimalEditSpans } from "./minimal-edit-script.js";

export type RevisionPiece =
  | { kind: "text"; text: string }
  | { kind: "change"; before: string; after: string };

/** Unchanged characters stay outside the revision. A trailing 「你好」 is only an insert. */
export function revisionPieces(before: string, after: string): RevisionPiece[] {
  const spans = computeMinimalEditSpans(before, after);
  if (spans.length === 0) {
    return before ? [{ kind: "text", text: before }] : [];
  }
  const pieces: RevisionPiece[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.spanStart > cursor) {
      pieces.push({ kind: "text", text: before.slice(cursor, span.spanStart) });
    }
    pieces.push({ kind: "change", before: span.before, after: span.after });
    cursor = span.spanEnd;
  }
  if (cursor < before.length) {
    pieces.push({ kind: "text", text: before.slice(cursor) });
  }
  return pieces;
}

/** Edit the one changed fragment without replacing the whole sentence in storage. */
export function replaceSingleChange(before: string, after: string, nextPiece: string): string {
  const spans = computeMinimalEditSpans(before, after);
  if (spans.length !== 1) {
    return nextPiece;
  }
  const span = spans[0];
  if (!span) {
    return nextPiece;
  }
  return before.slice(0, span.spanStart) + nextPiece + before.slice(span.spanEnd);
}
