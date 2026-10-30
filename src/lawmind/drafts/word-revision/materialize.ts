import { computeMinimalEditSpans } from "../minimal-edit-script.js";
import { finalOffsetToAll, finalText, replaceRange } from "./compose.js";
import type { ComposeAuthor, WordRevisionRun } from "./types.js";

export type MaterializeHunk = {
  before: string;
  after: string;
};

/**
 * Pending redline hunks become Word tracks attributed to `author` (修订署名).
 * Already-present native markup is left alone: `before` must still sit in
 * the final text.
 */
export function materializeHunks(
  runs: WordRevisionRun[],
  hunks: readonly MaterializeHunk[],
  author: ComposeAuthor,
  /** 与 hunks 同序的显示时间；不传时沿用 author.now。 */
  dates?: readonly string[],
): WordRevisionRun[] {
  let current = runs;
  for (const [index, hunk] of hunks.entries()) {
    const before = hunk.before;
    const after = hunk.after;
    if (!before || before === after) {
      continue;
    }
    const date = dates?.[index];
    const hunkAuthor = date ? { ...author, now: date } : author;
    const final = finalText(current);
    const at = final.indexOf(before);
    if (at < 0) {
      continue;
    }
    const spans = computeMinimalEditSpans(before, after);
    if (spans.length === 0) {
      continue;
    }
    for (const span of spans.toReversed()) {
      const start = finalOffsetToAll(current, at + span.spanStart);
      const end = finalOffsetToAll(current, at + span.spanEnd);
      // 每个 hunk 自己一条插入轨：相邻 hunk 不共用 w:id，Word 才分得开。
      current = replaceRange(current, start, end, span.after, hunkAuthor, {
        reuseInsertion: false,
      });
    }
  }
  return current;
}
