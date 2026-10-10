import {
  applyFormatRange,
  attachComment,
  coalesceRuns,
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
import { normalizeWordControls } from "../../../../../src/lawmind/drafts/word-surface-breaks.ts";

export function snapshotHasEngine(snapshot: WordSurfaceSnapshot | null): boolean {
  return Boolean(snapshot?.paragraphs.some((paragraph) => paragraph.runs != null));
}

function flattenSurfaceParagraphs(blocks: WordSurfaceBlock[] | undefined): WordSurfaceParagraph[] {
  if (!blocks || blocks.length === 0) {
    return [];
  }
  const out: WordSurfaceParagraph[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const { kind: _kind, ...paragraph } = block;
      out.push(paragraph);
      continue;
    }
    for (const row of block.rows) {
      for (const cell of row) {
        out.push(...flattenSurfaceParagraphs(cell.blocks));
      }
    }
  }
  return out;
}

/** Header → body → footnotes → footer — matches DOM `data-paragraph-index` order. */
export function editableParagraphsOf(
  snapshot: WordSurfaceSnapshot | null,
): WordSurfaceParagraph[] {
  if (!snapshot) {
    return [];
  }
  return [
    ...flattenSurfaceParagraphs(snapshot.headerBlocks),
    ...(snapshot.paragraphs ?? []),
    ...flattenSurfaceParagraphs(snapshot.footnoteBlocks),
    ...flattenSurfaceParagraphs(snapshot.footerBlocks),
  ];
}

export function storyParagraphOffset(snapshot: WordSurfaceSnapshot | null): number {
  return flattenSurfaceParagraphs(snapshot?.headerBlocks).length;
}

export function paragraphRunsOf(snapshot: WordSurfaceSnapshot | null): WordRevisionRun[][] {
  return editableParagraphsOf(snapshot).map((paragraph) => paragraph.runs ?? []);
}

function countParagraphsInBlocks(blocks: WordSurfaceBlock[] | undefined): number {
  return flattenSurfaceParagraphs(blocks).length;
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
    const length = wordMarkContentLength(mark);
    if (allOffset > from + length) {
      continue;
    }
    placeCaretInMark(mark, Math.max(0, allOffset - from), range);
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
  const clean = normalizeWordControls(text);
  if (caret.end > caret.start) {
    return replaceRange(runs, caret.start, caret.end, clean, author);
  }
  return insertText(runs, caret.offset, clean, author);
}

/** Text length plus one for each rendered line break or page break. */
export function wordMarkContentLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (isWordBreakNode(node)) {
    return 1;
  }
  let total = 0;
  for (const child of node.childNodes) {
    total += wordMarkContentLength(child);
  }
  return total;
}

/** Caret offset inside a mark, counting `<br>` and page-break spans as one character. */
export function wordMarkOffset(root: Node, target: Node, targetOffset: number): number | null {
  let count = 0;
  const visit = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        const end = Math.max(0, Math.min(targetOffset, node.childNodes.length));
        for (let i = 0; i < end; i += 1) {
          const child = node.childNodes[i];
          if (child) {
            count += wordMarkContentLength(child);
          }
        }
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE || isWordBreakNode(node)) {
      count += wordMarkContentLength(node);
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };
  return visit(root) ? count : null;
}

function isWordBreakNode(node: Node): boolean {
  return (
    node instanceof HTMLBRElement ||
    (node instanceof HTMLElement && Boolean(node.dataset.wordBreak))
  );
}

function placeCaretInMark(mark: HTMLElement, local: number, range: Range): void {
  let remain = local;
  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remain <= len) {
        range.setStart(node, remain);
        range.collapse(true);
        return true;
      }
      remain -= len;
      return false;
    }
    if (isWordBreakNode(node)) {
      if (remain <= 0) {
        range.setStartBefore(node);
        range.collapse(true);
        return true;
      }
      remain -= 1;
      if (remain <= 0) {
        range.setStartAfter(node);
        range.collapse(true);
        return true;
      }
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };
  if (!visit(mark)) {
    range.selectNodeContents(mark);
    range.collapse(false);
  }
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
  const expected = editableParagraphsOf(snapshot).length;
  if (paragraphs.length !== expected) {
    return snapshotWithParagraphRuns(snapshot, paragraphs);
  }
  return applyUnifiedRuns(snapshot, paragraphs);
}

/** Body paint tree. Fall back to flat paragraphs when blocks were not loaded. */
function bodyBlocksOf(snapshot: WordSurfaceSnapshot): WordSurfaceBlock[] {
  if (snapshot.blocks.length > 0) {
    return snapshot.blocks;
  }
  return snapshot.paragraphs.map((paragraph) => ({ ...paragraph, kind: "paragraph" as const }));
}

function applyBlockRuns(
  blocks: WordSurfaceBlock[],
  paragraphs: WordRevisionRun[][],
  cursor: { current: number },
): WordSurfaceBlock[] {
  return blocks.map((block) => {
    if (block.kind === "table") {
      return {
        ...block,
        rows: block.rows.map((row) =>
          row.map((cell) => ({
            ...cell,
            blocks: applyBlockRuns(cell.blocks, paragraphs, cursor),
          })),
        ),
      };
    }
    const runs = paragraphs[cursor.current] ?? block.runs ?? [];
    cursor.current += 1;
    return { ...paragraphFromRuns(block, runs), kind: "paragraph" as const };
  });
}

function applyUnifiedRuns(
  snapshot: WordSurfaceSnapshot,
  paragraphs: WordRevisionRun[][],
): WordSurfaceSnapshot {
  const cursor = { current: 0 };
  const headerBlocks = snapshot.headerBlocks
    ? applyBlockRuns(snapshot.headerBlocks, paragraphs, cursor)
    : undefined;
  const nextBlocks = applyBlockRuns(bodyBlocksOf(snapshot), paragraphs, cursor);
  const nextParagraphs = flattenSurfaceParagraphs(nextBlocks);
  const footnoteBlocks = snapshot.footnoteBlocks
    ? applyBlockRuns(snapshot.footnoteBlocks, paragraphs, cursor)
    : undefined;
  const footerBlocks = snapshot.footerBlocks
    ? applyBlockRuns(snapshot.footerBlocks, paragraphs, cursor)
    : undefined;
  return finishSnapshot(snapshot, nextParagraphs, nextBlocks, paragraphs.flat(), {
    ...(headerBlocks ? { headerBlocks } : {}),
    ...(footnoteBlocks ? { footnoteBlocks } : {}),
    ...(footerBlocks ? { footerBlocks } : {}),
  });
}

/** Split runs at an all-markup offset. Preserved drawing atoms stay on the side they fall on. */
export function splitRunsAt(
  runs: WordRevisionRun[],
  offset: number,
): { before: WordRevisionRun[]; after: WordRevisionRun[] } {
  const atoms = flattenRuns(runs);
  const at = Math.max(0, Math.min(offset, atoms.length));
  return {
    before: coalesceRuns(atoms.slice(0, at)),
    after: coalesceRuns(atoms.slice(at)),
  };
}

/**
 * Replace paragraph `index` with `before` and insert `after` as a new paragraph
 * immediately after (sourceIndex: null). Used for Enter / insertParagraph.
 */
export function snapshotSplitParagraph(
  snapshot: WordSurfaceSnapshot,
  index: number,
  before: WordRevisionRun[],
  after: WordRevisionRun[],
): WordSurfaceSnapshot {
  const paragraphs = paragraphRunsOf(snapshot);
  if (index < 0 || index >= paragraphs.length) {
    return snapshot;
  }
  const nextRuns = [
    ...paragraphs.slice(0, index),
    before,
    after,
    ...paragraphs.slice(index + 1),
  ];
  return snapshotWithParagraphRuns(snapshot, nextRuns, { splitAt: index });
}

function snapshotWithParagraphRuns(
  snapshot: WordSurfaceSnapshot,
  paragraphs: WordRevisionRun[][],
  opts?: { splitAt?: number },
): WordSurfaceSnapshot {
  const splitAt = opts?.splitAt;
  const headerCount = countParagraphsInBlocks(snapshot.headerBlocks);
  const bodyCount = snapshot.paragraphs.length;
  const footnoteCount = countParagraphsInBlocks(snapshot.footnoteBlocks);
  let globalCursor = 0;

  const walkRegion = (
    blocks: WordSurfaceBlock[] | undefined,
  ): { blocks: WordSurfaceBlock[]; paragraphs: WordSurfaceParagraph[] } => {
    if (!blocks) {
      return { blocks: [], paragraphs: [] };
    }
    const nextParagraphs: WordSurfaceParagraph[] = [];
    const walk = (list: WordSurfaceBlock[]): WordSurfaceBlock[] => {
      const out: WordSurfaceBlock[] = [];
      for (const block of list) {
        if (block.kind === "table") {
          out.push({
            ...block,
            rows: block.rows.map((row) =>
              row.map((cell) => ({ ...cell, blocks: walk(cell.blocks) })),
            ),
          });
          continue;
        }
        const runs = paragraphs[globalCursor] ?? block.runs ?? [];
        const base = paragraphFromRuns(block, runs);
        if (splitAt != null && globalCursor === splitAt) {
          const insertedRuns = paragraphs[globalCursor + 1] ?? [];
          const head = {
            ...base,
            sourceIndex: block.sourceIndex ?? null,
            ...(block.storyPart ? { storyPart: block.storyPart } : {}),
          };
          const inserted = paragraphFromRuns(
            {
              ...(block.pPrInner ? { pPrInner: block.pPrInner } : {}),
              ...(block.align ? { align: block.align } : {}),
              ...(block.line ? { line: block.line } : {}),
              ...(block.fontFamily ? { fontFamily: block.fontFamily } : {}),
              ...(block.outlineLevel != null ? { outlineLevel: block.outlineLevel } : {}),
              ...(block.storyPart ? { storyPart: block.storyPart } : {}),
              segments: [],
              sourceIndex: null,
            },
            insertedRuns,
          );
          out.push({ ...head, kind: "paragraph" as const });
          out.push({ ...inserted, kind: "paragraph" as const, sourceIndex: null });
          nextParagraphs.push(head, inserted);
          globalCursor += 2;
          continue;
        }
        nextParagraphs.push(base);
        out.push({ ...base, kind: "paragraph" as const });
        globalCursor += 1;
      }
      return out;
    };
    return { blocks: walk(blocks), paragraphs: nextParagraphs };
  };

  const header = walkRegion(snapshot.headerBlocks);
  const body = walkRegion(bodyBlocksOf(snapshot));
  const footnote = walkRegion(snapshot.footnoteBlocks);
  const footer = walkRegion(snapshot.footerBlocks);

  // Length mismatch fallback: pad body paragraphs if needed.
  while (
    header.paragraphs.length + body.paragraphs.length + footnote.paragraphs.length + footer.paragraphs.length <
    paragraphs.length
  ) {
    const i =
      header.paragraphs.length +
      body.paragraphs.length +
      footnote.paragraphs.length +
      footer.paragraphs.length;
    const prior = snapshot.paragraphs[Math.min(i - headerCount, Math.max(0, bodyCount - 1))];
    const added = paragraphFromRuns(
      {
        segments: [],
        ...(prior?.pPrInner ? { pPrInner: prior.pPrInner } : {}),
        ...(prior?.storyPart ? { storyPart: prior.storyPart } : { storyPart: "word/document.xml" }),
        sourceIndex: null,
      },
      paragraphs[i] ?? [],
    );
    body.paragraphs.push(added);
    body.blocks.push({ ...added, kind: "paragraph" });
  }

  void footnoteCount;
  return finishSnapshot(snapshot, body.paragraphs, body.blocks, paragraphs.flat(), {
    ...(snapshot.headerBlocks ? { headerBlocks: header.blocks } : {}),
    ...(snapshot.footnoteBlocks ? { footnoteBlocks: footnote.blocks } : {}),
    ...(snapshot.footerBlocks ? { footerBlocks: footer.blocks } : {}),
  });
}

function finishSnapshot(
  snapshot: WordSurfaceSnapshot,
  nextParagraphs: WordSurfaceParagraph[],
  nextBlocks: WordSurfaceBlock[],
  flatRuns: WordRevisionRun[],
  storyBlocks?: {
    headerBlocks?: WordSurfaceBlock[];
    footnoteBlocks?: WordSurfaceBlock[];
    footerBlocks?: WordSurfaceBlock[];
  },
): WordSurfaceSnapshot {
  const colors = colorsForRuns(flatRuns);
  const bodyTracked: WordTrackedView[] = collectBalloons(flatRuns, colors).map((row) => ({
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
    blocks: nextBlocks,
    ...(storyBlocks?.headerBlocks ? { headerBlocks: storyBlocks.headerBlocks } : {}),
    ...(storyBlocks?.footnoteBlocks ? { footnoteBlocks: storyBlocks.footnoteBlocks } : {}),
    ...(storyBlocks?.footerBlocks ? { footerBlocks: storyBlocks.footerBlocks } : {}),
    tracked,
    authors: [...new Set(tracked.map((row) => row.author))],
  };
}

function paragraphFromRuns(paragraph: WordSurfaceParagraph, runs: WordRevisionRun[]): WordSurfaceParagraph {
  const colors = colorsForRuns(runs);
  let from = 0;
  const segments: WordSurfaceSegment[] = [];
  for (const run of runs) {
    if (run.image) {
      from += run.text.length;
      segments.push({
        kind: "image" as const,
        src: run.image.src,
        ...(run.image.widthPx != null ? { widthPx: run.image.widthPx } : {}),
        ...(run.image.heightPx != null ? { heightPx: run.image.heightPx } : {}),
        alt: "文档图片",
      });
      continue;
    }
    if (run.preservedXml && (!run.text || run.text === "\uFFFC")) {
      from += run.text.length || 1;
      continue;
    }
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
    segments.push(base);
  }
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
    const local = wordMarkOffset(mark, node, offset);
    if (local != null) {
      return from + local;
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
