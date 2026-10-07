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

/** True when a Word balloon is the painted form of this redline hunk. */
export function trackCoversHunk(
  row: { change: string; text: string },
  hunk: { before: string; after: string },
): boolean {
  const text = row.text.trim();
  if (!text) {
    return false;
  }
  if (row.change === "del" || row.change === "moveFrom") {
    return hunk.before.includes(text);
  }
  if (row.change === "ins" || row.change === "moveTo") {
    return hunk.after.includes(text);
  }
  return false;
}

/** Edit one changed fragment. The stored sentence keeps the unchanged characters. */
export function replaceChangeAfter(
  before: string,
  after: string,
  changeIndex: number,
  nextAfter: string,
): string {
  const spans = computeMinimalEditSpans(before, after);
  if (spans.length === 0) {
    return nextAfter;
  }
  const span = spans[changeIndex];
  if (!span) {
    return after;
  }
  let result = "";
  let cursor = 0;
  spans.forEach((item, index) => {
    result += before.slice(cursor, item.spanStart);
    result += index === changeIndex ? nextAfter : item.after;
    cursor = item.spanEnd;
  });
  result += before.slice(cursor);
  return result;
}
