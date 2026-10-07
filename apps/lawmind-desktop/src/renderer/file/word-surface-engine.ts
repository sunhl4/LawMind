import {
  applyFormatRange,
  attachComment,
  collectBalloons,
  colorsForRuns,
  decideRuns,
  deleteBackward,
  deleteForward,
  finalOffsetToAll,
  flattenRuns,
  insertText,
  makeAuthorClock,
  maxTrackId,
  moveRange,
  originalOffsetToAll,
  replaceRange,
  withAcceptedDisposition,
  type WordMarkupMode,
  type WordRevisionRun,
} from "../../../../../src/lawmind/drafts/word-revision/index.ts";
import type {
  WordSurfaceBlock,
  WordSurfaceParagraph,
  WordSurfaceSegment,
  WordSurfaceSnapshot,
  WordTrackedView,
} from "../../../../../src/lawmind/drafts/word-surface.ts";
import { DEFAULT_WORD_REVISION_AUTHOR } from "../../../../../src/lawmind/policy/word-revision-author.ts";

export function snapshotHasEngine(snapshot: WordSurfaceSnapshot | null): boolean {
  return Boolean(snapshot?.paragraphs.some((paragraph) => paragraph.runs != null));
}

export function paragraphRunsOf(snapshot: WordSurfaceSnapshot | null): WordRevisionRun[][] {
  return (snapshot?.paragraphs ?? []).map((paragraph) => paragraph.runs ?? []);
}

export function ownRevisionName(snapshot: WordSurfaceSnapshot | null): string {
  return snapshot?.revisionAuthor?.trim() || DEFAULT_WORD_REVISION_AUTHOR;
}

export function isOwnRevisionAuthor(
  author: string | undefined,
  snapshot: WordSurfaceSnapshot | null,
): boolean {
  const name = author?.trim();
  return Boolean(name) && name === ownRevisionName(snapshot);
}

export function acceptParagraphTracks(
  paragraphs: WordRevisionRun[][],
  revIds: readonly string[],
): WordRevisionRun[][] {
  const ids = new Set(revIds);
  return paragraphs.map((runs) => withAcceptedDisposition(runs, ids));
}

/** True when this edit would change a track that is not the local 修订署名. */
export function editHitsForeignTrack(
  runs: WordRevisionRun[],
  caret: { offset: number; start: number; end: number },
  ownAuthor: string,
  kind: "insert" | "delete-back" | "delete-forward",
): boolean {
  const own = ownAuthor.trim();
  const atoms = flattenRuns(runs);
  const foreign = (index: number) => {
    const track = atoms[index]?.track;
    return Boolean(track && track.author.trim() !== own);
  };
  const from = Math.min(caret.start, caret.end);
  const to = Math.max(caret.start, caret.end);
  if (to > from) {
    for (let index = from; index < to; index += 1) {
      if (foreign(index)) {
        return true;
      }
    }
    return false;
  }
  if (kind === "delete-back") {
    return caret.offset > 0 && foreign(caret.offset - 1);
  }
  if (kind === "delete-forward") {
    return foreign(caret.offset);
  }
  const left = caret.offset > 0 ? atoms[caret.offset - 1]?.track : undefined;
  const right = atoms[caret.offset]?.track;
  return Boolean(
    left &&
      right &&
      left.author.trim() !== own &&
      right.author.trim() !== own &&
      left.id === right.id &&
      left.kind === right.kind,
  );
}

export function authorClockFor(snapshot: WordSurfaceSnapshot | null): ReturnType<typeof makeAuthorClock> {
  const name = ownRevisionName(snapshot);
  let max = 0;
  for (const runs of paragraphRunsOf(snapshot)) {
    max = Math.max(max, maxTrackId(runs));
  }
  return makeAuthorClock(name, max + 1);
}

export function caretEngineOffset(
  paragraph: HTMLElement,
  runs: WordRevisionRun[],
  markup: WordMarkupMode,
  hiddenAuthors?: Set<string>,
): { offset: number; start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!paragraph.contains(range.commonAncestorContainer)) {
    return null;
  }
  const visibleStart = visibleOffset(paragraph, range.startContainer, range.startOffset);
  const visibleEnd = range.collapsed
    ? visibleStart
    : visibleOffset(paragraph, range.endContainer, range.endOffset);
  if (visibleStart == null || visibleEnd == null) {
    return null;
  }
  const start = toAllMarkup(runs, Math.min(visibleStart, visibleEnd), markup, hiddenAuthors);
  const end = toAllMarkup(runs, Math.max(visibleStart, visibleEnd), markup, hiddenAuthors);
  return { offset: start, start, end };
}

export function restoreCaret(paragraph: HTMLElement, allOffset: number): void {
  const marks = [...paragraph.querySelectorAll<HTMLElement>("[data-all-from]")];
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  paragraph.focus();
  const range = document.createRange();
  for (const mark of marks) {
    const from = Number(mark.dataset.allFrom ?? "0");
    const length = mark.textContent?.length ?? 0;
    if (allOffset > from + length) {
      continue;
    }
    const node = textNodeOf(mark);
    const at = Math.max(0, Math.min(length, allOffset - from));
    if (node) {
      range.setStart(node, at);
    } else {
      range.selectNodeContents(mark);
      range.collapse(true);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  range.selectNodeContents(paragraph);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function applyEngineInsert(
  runs: WordRevisionRun[],
  caret: { offset: number; start: number; end: number },
  text: string,
  author: ReturnType<typeof makeAuthorClock>,
): WordRevisionRun[] {
  if (caret.end > caret.start) {
    return replaceRange(runs, caret.start, caret.end, text, author);
  }
  return insertText(runs, caret.offset, text, author);
}

export function applyEngineDelete(
  runs: WordRevisionRun[],
  caret: { offset: number; start: number; end: number },
  backward: boolean,
  author: ReturnType<typeof makeAuthorClock>,
): WordRevisionRun[] {
  if (caret.end > caret.start) {
    return replaceRange(runs, caret.start, caret.end, "", author);
  }
  if (backward) {
    return deleteBackward(runs, caret.offset, 1, author).runs;
  }
  return deleteForward(runs, caret.offset, 1, author).runs;
}

export function applyEngineMove(
  runs: WordRevisionRun[],
  caret: { start: number; end: number },
  insertAt: number,
  author: ReturnType<typeof makeAuthorClock>,
): WordRevisionRun[] {
  if (caret.end <= caret.start) {
    return runs;
  }
  return moveRange(runs, caret.start, caret.end, insertAt, author);
}

export function decideParagraphRuns(
  paragraphs: WordRevisionRun[][],
  revId: string,
  decision: "accept" | "reject",
): WordRevisionRun[][] {
  return paragraphs.map((runs) => decideRuns(runs, revId, decision));
}

export function applyEngineFormat(
  runs: WordRevisionRun[],
  caret: { start: number; end: number },
  format: "加粗" | "倾斜" | "下划线",
  author: ReturnType<typeof makeAuthorClock>,
): WordRevisionRun[] {
  if (caret.end <= caret.start) {
    return runs;
  }
  return applyFormatRange(runs, caret.start, caret.end, format, author);
}

export function commentOnRange(
  runs: WordRevisionRun[],
  caret: { start: number; end: number },
  commentId: string,
): WordRevisionRun[] {
  if (caret.end <= caret.start) {
    return runs;
  }
  return attachComment(runs, caret.start, caret.end, commentId);
}

export function snapshotWithRuns(
  snapshot: WordSurfaceSnapshot,
  paragraphs: WordRevisionRun[][],
  _markup?: WordMarkupMode,
  _hiddenAuthors?: Set<string>,
): WordSurfaceSnapshot {
  let index = 0;
  const nextParagraphs = snapshot.paragraphs.map((paragraph) => {
    const runs = paragraphs[index] ?? paragraph.runs ?? [];
    index += 1;
    return paragraphFromRuns(paragraph, runs);
  });
  index = 0;
  const walk = (blocks: WordSurfaceBlock[]): WordSurfaceBlock[] =>
    blocks.map((block) => {
      if (block.kind === "table") {
        return {
          ...block,
          rows: block.rows.map((row) =>
            row.map((cell) => ({ ...cell, blocks: walk(cell.blocks) })),
          ),
        };
      }
      const runs = paragraphs[index] ?? block.runs ?? [];
      index += 1;
      return { ...paragraphFromRuns(block, runs), kind: "paragraph" as const };
    });
  const colors = colorsForRuns(paragraphs.flat());
  const bodyTracked: WordTrackedView[] = collectBalloons(paragraphs.flat(), colors).map((row) => ({
    revId: row.revId,
    change: row.change,
    author: row.author,
    text: row.text,
    color: row.color,
    ...(row.date ? { date: row.date } : {}),
    ...(row.format ? { format: row.format } : {}),
    ...(row.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
  }));
  const bodyIds = new Set(bodyTracked.map((row) => row.revId));
  const extra = (snapshot.tracked ?? []).filter((row) => !bodyIds.has(row.revId));
  const tracked = [...extra, ...bodyTracked];
  return {
    ...snapshot,
    paragraphs: nextParagraphs,
    blocks: walk(snapshot.blocks),
    tracked,
    authors: [...new Set(tracked.map((row) => row.author))],
  };
}

function paragraphFromRuns(paragraph: WordSurfaceParagraph, runs: WordRevisionRun[]): WordSurfaceParagraph {
  const colors = colorsForRuns(runs);
  let from = 0;
  const segments: WordSurfaceSegment[] = runs.map((run) => {
    const base = run.track
      ? {
          kind: "tracked" as const,
          revId: run.track.id,
          change: run.track.kind,
          author: run.track.author,
          text: run.text,
          color: colors.get(run.track.author.trim()) ?? 0,
          ...(run.track.date ? { date: run.track.date } : {}),
          ...(run.track.format ? { format: run.track.format } : {}),
          ...(run.track.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
          ...run.mark,
        }
      : { kind: "text" as const, text: run.text, ...run.mark };
    from += run.text.length;
    return base;
  });
  return { ...paragraph, runs, segments };
}

function toAllMarkup(
  runs: WordRevisionRun[],
  visible: number,
  markup: WordMarkupMode,
  hiddenAuthors?: Set<string>,
): number {
  if (markup === "all" && (!hiddenAuthors || hiddenAuthors.size === 0)) {
    return visible;
  }
  if (markup === "original") {
    return originalOffsetToAll(runs, visible);
  }
  return finalOffsetToAll(runs, visible);
}

function visibleOffset(paragraph: HTMLElement, node: Node, offset: number): number | null {
  const mark = closestAllFrom(paragraph, node);
  if (mark && (!hiddenInView(mark))) {
    const from = Number(mark.dataset.allFrom ?? "0");
    if (node.nodeType === Node.TEXT_NODE) {
      return from + offset;
    }
  }
  try {
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function closestAllFrom(paragraph: HTMLElement, node: Node): HTMLElement | null {
  const target = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!(target instanceof Element)) {
    return null;
  }
  const mark = target.closest<HTMLElement>("[data-all-from]");
  return mark && paragraph.contains(mark) ? mark : null;
}

function hiddenInView(mark: HTMLElement): boolean {
  return mark.hidden || mark.style.display === "none";
}

function textNodeOf(el: HTMLElement): Text | null {
  if (el.firstChild?.nodeType === Node.TEXT_NODE) {
    return el.firstChild as Text;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
}
