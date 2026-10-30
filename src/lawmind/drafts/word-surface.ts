/**
 * Chat-middle Word review of the open .docx. The page is the file: native
 * w:ins / w:del / moves / format marks, by-author colors, and pending redline
 * hunks materialized as Word tracks under 设置 → 修订署名 (blank = LawMind).
 * 接受 = 折叠并保留痕迹（导出仍是 Word 修订）；拒绝 = 从正文和导出拿掉。
 * Save writes this file.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveWordBaselineAbs,
  type WordBaselineRoot,
} from "../artifacts/word-revision-delivery.js";
import { readLawyerIdentity } from "../matter-replica/identity.js";
import { resolveWordRevisionAuthor } from "../policy/word-revision-author.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ArtifactDraft } from "../types.js";
import { loadDocxZip } from "./docx-size.js";
import { listDrafts, persistDraft, readDraft } from "./index.js";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";
import {
  appendLawyerHunk,
  FORMAT_RATIONALE_PREFIX,
  LAWYER_SURFACE_RATIONALE,
  MOVE_RATIONALE,
  readRedlineProposal,
  replaceLawyerHunks,
  summarizeRedline,
  type RedlineHunk,
  type RedlineProposal,
} from "./redline-proposal.js";
import { planRevisionTimestamps } from "./revision-timestamps.js";
import { layoutRunsToRevision, loadDocxStories } from "./word-revision/document.js";
import {
  collectAuthors,
  collectBalloons,
  contiguousGroupKeys,
  finalOffsetToAll,
  finalText,
  makeAuthorClock,
  maxTrackId,
  replacePlain,
  replaceRange,
  withAcceptedDisposition,
  WORD_REVISION_COLOR_COUNT,
} from "./word-revision/index.js";
import type {
  WordRevisionComment,
  WordRevisionBalloon,
  WordRevisionRun,
} from "./word-revision/index.js";
import {
  defaultWordPage,
  extractDocxLayout,
  layoutPlainTexts,
  type WordAlign,
  type WordLayoutBlock,
  type WordLayoutRun,
  type WordLineSpacing,
  type WordTrackKind,
  type WordTrackMark,
  type WordMeasure,
  type WordPageBox,
  type WordRunMark,
  type WordLayoutDocument,
} from "./word-surface-layout.js";
import { outlineEntriesOf } from "./word-surface-outline.js";
import { revisionPieces, trackCoversHunk } from "./word-surface-pieces.js";

/**
 * Word's "by author" cycle: red, blue, green, violet, dark red, teal,
 * dark yellow, gray. The file does not store a color. The first author in
 * the document is red, the next blue, then the list repeats.
 */
export { WORD_REVISION_COLOR_COUNT, trackCoversHunk };
export { outlineEntriesOf } from "./word-surface-outline.js";

export type WordSurfaceMark = WordRunMark;

export type WordSurfaceSegment = (
  | { kind: "text"; text: string }
  | {
      kind: "revision";
      hunkId: string;
      before: string;
      after: string;
      rationale?: string;
      /** Index into the shared revision palette. Same value as the rail card. */
      color?: number;
    }
  | {
      kind: "tracked";
      revId: string;
      change: WordTrackKind;
      author: string;
      text: string;
      date?: string;
      /** Index into Word's by-author palette. Same author, same color. */
      color: number;
      format?: string;
      disposition?: "open" | "accepted";
      /** Redline hunk this track was materialized from (absent on Word's own marks). */
      hunkId?: string;
      /** First w:id of the contiguous revision this mark belongs to. */
      groupId?: string;
    }
  | {
      kind: "image";
      src: string;
      widthPx?: number;
      heightPx?: number;
      alt?: string;
    }
) &
  WordSurfaceMark;

/** One native revision, merged for the margin balloon. */
export type WordTrackedView = {
  revId: string;
  /** Every w:id covered by this balloon. Contiguous delete+insert share one. */
  revIds?: string[];
  change: WordTrackKind;
  /** Pieces of one contiguous revision, in document order. */
  parts?: { change: WordTrackKind; text: string }[];
  author: string;
  text: string;
  date?: string;
  color: number;
  format?: string;
  disposition?: "open" | "accepted";
  /** Redline hunk this track was materialized from (absent on Word's own marks). */
  hunkId?: string;
  /** Every hunk inside one contiguous revision. */
  hunkIds?: string[];
};

export type { WordLineSpacing, WordMeasure, WordPageBox } from "./word-surface-layout.js";

export type WordSurfaceParagraph = {
  align?: WordAlign;
  indent?: WordMeasure;
  firstIndent?: WordMeasure;
  spaceBefore?: WordMeasure;
  spaceAfter?: WordMeasure;
  line?: WordLineSpacing;
  fontFamily?: string;
  listLabel?: string;
  /** 1-based outline level; absent on body paragraphs. */
  outlineLevel?: number;
  /** Docx text before lawyer edits. Control+S compares the paragraph against this. */
  baselineText?: string;
  segments: WordSurfaceSegment[];
  /** All-markup runs. The surface composes Word edits against this, not the DOM. */
  runs?: WordRevisionRun[];
  pPrInner?: string;
  /**
   * Index of this paragraph in the loaded story part's `w:p` sequence.
   * `null` = inserted after load (Enter).
   */
  sourceIndex?: number | null;
  /** Zip part this paragraph belongs to, e.g. `word/document.xml` / `word/header1.xml`. */
  storyPart?: string;
};

export type WordSurfaceOutlineEntry = {
  paragraphIndex: number;
  level: number;
  text: string;
};

export type WordSurfaceCell = {
  blocks: WordSurfaceBlock[];
  colspan?: number;
  widthPx?: number;
  vertical?: boolean;
  vAlign?: "top" | "center" | "bottom";
  rowTrack?: WordTrackedView;
};

export type WordSurfaceBlock =
  | ({ kind: "paragraph" } & WordSurfaceParagraph)
  | {
      kind: "table";
      bordered?: boolean;
      widthPx?: number;
      widthPct?: number;
      colWidthsPx?: number[];
      rows: WordSurfaceCell[][];
    };

export type WordSurfaceHunkView = {
  hunkId: string;
  before: string;
  after: string;
  status: RedlineHunk["status"];
  rationale?: string;
  sectionHeading?: string;
  /** Palette index. Same author keeps the same color. */
  color: number;
  /** False when `before` is not in the open file (still decidable from the rail). */
  placed: boolean;
  author?: string;
  revisedAt?: string;
};

export type WordSurfaceSnapshot = {
  fileName: string;
  relPath: string;
  root: WordBaselineRoot;
  taskId: string | null;
  updatedAt: string | null;
  blocks: WordSurfaceBlock[];
  /** Reading order, including paragraphs inside tables. */
  paragraphs: WordSurfaceParagraph[];
  /** Heading outline for the left nav (built from paragraph outlineLevel). */
  outline?: WordSurfaceOutlineEntry[];
  hunks: WordSurfaceHunkView[];
  /** Revisions already in the file, in document order. Absent on older snapshots. */
  tracked?: WordTrackedView[];
  /** Paper size and the document default face. Absent only on older snapshots. */
  page?: WordPageBox;
  summary: { pending: number; accepted: number; rejected: number };
  /** Distinct authors in document order, for Word's "specific people" filter. */
  authors?: string[];
  headerBlocks?: WordSurfaceBlock[];
  footerBlocks?: WordSurfaceBlock[];
  footnoteBlocks?: WordSurfaceBlock[];
  docxComments?: WordRevisionComment[];
  /** File mtime used to skip a repeat unzip. Absent on snapshots built without a file. */
  fileMtimeMs?: number;
  /** Proposal `updatedAt`, or empty when there is no proposal. Matches the unchanged check. */
  proposalUpdatedAt?: string;
  /** Local lawyer display name for rail bylines (falls back to「律师」). */
  lawyerDisplayName?: string;
  /** Word 修订署名。设置里写了就用那个名字，否则 LawMind。 */
  revisionAuthor?: string;
};

/**
 * Paragraph texts in document order. Empty paragraphs are dropped.
 * Start-tag attributes and field instructions are not visible text.
 */
export function extractDocxParagraphsFromXml(xml: string): string[] {
  return layoutPlainTexts(extractDocxLayout(xml).blocks)
    .map((text) => text.trim())
    .filter(Boolean);
}

export async function readDocxLayout(absPath: string): Promise<WordLayoutBlock[]> {
  return (await readDocxDocument(absPath)).blocks;
}

/** Page box plus blocks. Format audits need the page; the preview only needs blocks. */
export async function readDocxDocumentLayout(absPath: string): Promise<WordLayoutDocument> {
  return readDocxDocument(absPath);
}

async function importDocxLayout(): Promise<{
  extractDocxLayout: typeof extractDocxLayout;
  defaultWordPage: typeof defaultWordPage;
}> {
  if (process.env.LAWMIND_PACKAGED === "1") {
    return { extractDocxLayout, defaultWordPage };
  }
  try {
    const layoutPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "word-surface-layout.ts",
    );
    const mtime = Math.round((await fs.stat(layoutPath)).mtimeMs);
    return (await import(`${pathToFileURL(layoutPath).href}?mtime=${mtime}`)) as {
      extractDocxLayout: typeof extractDocxLayout;
      defaultWordPage: typeof defaultWordPage;
    };
  } catch {
    return { extractDocxLayout, defaultWordPage };
  }
}

async function readDocxDocument(absPath: string): Promise<ReturnType<typeof extractDocxLayout>> {
  const layout = await importDocxLayout();
  // 体积/条目上限先于解析：坏包或超大包不该把本地服务卡住。
  const loaded = await loadDocxZip(absPath);
  if (!loaded.ok) {
    throw new Error(loaded.reason);
  }
  const zip = loaded.zip;
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) {
    return { page: layout.defaultWordPage(), blocks: [] };
  }
  const styles = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const numbering = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  return layout.extractDocxLayout(xml, styles, numbering);
}

export async function readDocxParagraphs(absPath: string): Promise<string[]> {
  return layoutPlainTexts(await readDocxLayout(absPath))
    .map((text) => text.trim())
    .filter(Boolean);
}

/** Stable draft id for a file the lawyer edits before any agent draft exists. */
export function surfaceEditTaskId(relPath: string): string {
  const norm = relPath.trim().replace(/\\/g, "/");
  return `ws-${createHash("sha256").update(norm).digest("hex").slice(0, 16)}`;
}

/**
 * Turn one unmodified sentence into a redline hunk. The rail and the tracked
 * Word export read that same list.
 */
export function recordLawyerSurfaceEdit(params: {
  workspaceDir: string;
  relPath: string;
  root: WordBaselineRoot;
  fileName: string;
  before: string;
  after: string;
  taskId?: string | null;
  /** When set, records a format revision even if the words did not change. */
  format?: "加粗" | "倾斜" | "下划线";
}): { ok: true; taskId: string; hunkId: string } | { ok: false; error: string } {
  const relPath = params.relPath.trim().replace(/\\/g, "/");
  const bound = findDraftForWordFile(listDrafts(params.workspaceDir), relPath);
  const taskId = params.taskId?.trim() || bound?.taskId || surfaceEditTaskId(relPath);
  if (!readDraft(params.workspaceDir, taskId)) {
    const now = new Date().toISOString();
    persistDraft(params.workspaceDir, {
      taskId,
      title: params.fileName.replace(/\.docx$/i, "") || "文档",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "",
      sections: [{ heading: "正文", body: params.before }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      contractEdit: {
        baselineRelativePath: relPath,
        baselineRoot: params.root,
        mode: "surgical",
      },
    });
  }
  const appended = appendLawyerHunk(params.workspaceDir, taskId, {
    before: params.before,
    after: params.format ? params.before : params.after,
    ...(params.format ? { rationale: `${FORMAT_RATIONALE_PREFIX}${params.format}` } : {}),
  });
  if (!appended.ok) {
    return appended;
  }
  return { ok: true, taskId, hunkId: appended.hunkId };
}

/**
 * Control+S: lawyer paragraphs that match the original lose their revision.
 * Paragraphs that differ become one minimal revision against that original.
 */
export function syncLawyerSurfaceDocument(params: {
  workspaceDir: string;
  relPath: string;
  root: WordBaselineRoot;
  fileName: string;
  taskId?: string | null;
  paragraphs: { baseline: string; current: string }[];
  /** Phrases cut in this document and pasted elsewhere. Stored as moves, not plain inserts. */
  moves?: string[];
}): { ok: true; taskId: string; removed: number; updated: number } | { ok: false; error: string } {
  const changed = params.paragraphs.filter(
    (row) => row.baseline.trim() && row.baseline !== row.current,
  );
  const relPath = params.relPath.trim().replace(/\\/g, "/");
  const bound = findDraftForWordFile(listDrafts(params.workspaceDir), relPath);
  const taskId = params.taskId?.trim() || bound?.taskId || surfaceEditTaskId(relPath);
  if (!readDraft(params.workspaceDir, taskId)) {
    if (changed.length === 0) {
      return { ok: true, taskId, removed: 0, updated: 0 };
    }
    persistDraft(params.workspaceDir, {
      taskId,
      title: params.fileName.replace(/\.docx$/i, "") || "文档",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "",
      sections: [{ heading: "正文", body: changed[0]?.baseline ?? "" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: {
        baselineRelativePath: relPath,
        baselineRoot: params.root,
        mode: "surgical",
      },
    });
  }
  const moves = new Set((params.moves ?? []).filter((text) => text.trim()));
  const res = replaceLawyerHunks(
    params.workspaceDir,
    taskId,
    changed.map((row) => ({
      before: row.baseline,
      after: row.current,
      ...(isMovedEdit(row.baseline, row.current, moves) ? { rationale: MOVE_RATIONALE } : {}),
    })),
  );
  if (!res.ok) {
    return res;
  }
  return { ok: true, taskId, removed: res.removed, updated: res.updated };
}

export function findDraftForWordFile(
  drafts: ArtifactDraft[],
  relPath: string,
): ArtifactDraft | undefined {
  const norm = relPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm) {
    return undefined;
  }
  const exact = drafts.filter(
    (draft) => (draft.contractEdit?.baselineRelativePath ?? "").replace(/\\/g, "/") === norm,
  );
  exact.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return exact[0];
}

type PaintableHunk = Pick<
  RedlineHunk,
  "hunkId" | "before" | "after" | "rationale" | "spanStart" | "spanEnd" | "status"
> & {
  color?: number;
  /** Baseline section body. Offsets are into this string, not a search hit. */
  sectionBody?: string;
};

export { replaceChangeAfter, revisionPieces, type RevisionPiece } from "./word-surface-pieces.js";

/**
 * Where a hunk sits in this paragraph.
 * Surgical inserts store an empty `before` and a character offset into the
 * baseline section. A search for that empty string would hit the start.
 */
function spanInText(
  text: string,
  hunk: PaintableHunk,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (start >= 0 && end >= start && end <= text.length && text.slice(start, end) === hunk.before) {
    return { start, end };
  }
  return null;
}

function revisionAnchor(text: string, hunk: PaintableHunk): { start: number; end: number } | null {
  const placed = sectionAnchor(text, hunk);
  if (placed) {
    return placed;
  }
  if (!hunk.before) {
    return null;
  }
  const start = text.indexOf(hunk.before);
  if (start < 0) {
    return null;
  }
  return { start, end: start + hunk.before.length };
}

/**
 * Where an already-accepted hunk may be folded into ordinary text.
 * Only the original section span counts. A later indexOf(`before`) would
 * rewrite a different sentence that happens to contain the same characters.
 */
function acceptedAnchor(text: string, hunk: PaintableHunk): { start: number; end: number } | null {
  const placed = sectionAnchor(text, hunk);
  if (placed) {
    return placed;
  }
  if (
    hunk.sectionBody != null &&
    typeof hunk.spanStart === "number" &&
    typeof hunk.spanEnd === "number"
  ) {
    return null;
  }
  return revisionAnchor(text, hunk);
}

function sectionAnchor(text: string, hunk: PaintableHunk): { start: number; end: number } | null {
  if (
    hunk.sectionBody == null ||
    typeof hunk.spanStart !== "number" ||
    typeof hunk.spanEnd !== "number"
  ) {
    return null;
  }
  if (hunk.sectionBody === text) {
    return spanInText(text, hunk, hunk.spanStart, hunk.spanEnd);
  }
  // The open file sometimes splits one baseline paragraph. Keep the offset
  // when this paragraph is a unique slice that still contains the change.
  if (text.length >= 40) {
    const at = hunk.sectionBody.indexOf(text);
    if (at >= 0 && hunk.sectionBody.indexOf(text, at + text.length) < 0) {
      return spanInText(text, hunk, hunk.spanStart - at, hunk.spanEnd - at);
    }
  }
  return null;
}

/** Paint pending hunks as Word tracks (修订署名, default LawMind) onto one paragraph. */
export function paintPendingRevisions(text: string, hunks: PaintableHunk[]): WordSurfaceSegment[] {
  return paintFormattedRuns([{ text }], hunks);
}

export function paintFormattedRuns(
  runs: WordLayoutRun[],
  hunks: PaintableHunk[],
  colors: Map<string, number> = new Map(),
  authorName = resolveWordRevisionAuthor(undefined),
): WordSurfaceSegment[] {
  const revisionRuns = layoutRunsToRevision(runs);
  const painted = applyHunksAsTracks(revisionRuns, hunks, authorName, {
    cursor: { next: maxTrackId(revisionRuns) + 1 },
  });
  return paintRevisionRuns(painted, colors);
}

/** Sidecar mapping: a track reloaded from the file still knows its hunk. */
function stampTrackHunks(
  runs: WordRevisionRun[],
  trackHunks: Readonly<Record<string, string>> | undefined,
): WordRevisionRun[] {
  if (!trackHunks) {
    return runs;
  }
  let changed = false;
  const next = runs.map((run) => {
    const id = run.track?.id;
    const hunkId = id ? trackHunks[id] : undefined;
    if (!run.track || !hunkId || run.track.hunkId === hunkId) {
      return run;
    }
    changed = true;
    return { ...run, track: { ...run.track, hunkId } };
  });
  return changed ? next : runs;
}

/**
 * Word's numeric `w:id` must be unique across the whole document. The preview
 * paints hunks paragraph by paragraph, so the counter is shared: restarting it
 * per paragraph made one accept fold same-id revisions in other paragraphs.
 */
type TrackIdCursor = { next: number };

type TrackContext = {
  cursor: TrackIdCursor;
  /** Persisted track id → hunk id from `word/lawmind-disposition.xml`. */
  trackHunks?: Readonly<Record<string, string>>;
  /** Hunks whose tracks are already in the file; painting them again duplicates text. */
  presentHunkIds?: ReadonlySet<string>;
};

function maxLayoutTrackId(blocks: readonly WordLayoutBlock[], max = 0): number {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const blockId = Number(block.blockTrack?.id);
      if (Number.isFinite(blockId) && blockId > max) {
        max = blockId;
      }
      for (const run of block.runs) {
        const id = Number(run.track?.id);
        if (Number.isFinite(id) && id > max) {
          max = id;
        }
      }
      continue;
    }
    for (const row of block.rows) {
      for (const cell of row) {
        const rowId = Number(cell.rowTrack?.id);
        if (Number.isFinite(rowId) && rowId > max) {
          max = rowId;
        }
        max = maxLayoutTrackId(cell.blocks, max);
      }
    }
  }
  return max;
}

/** Hunk ids already materialized in the file (track ids from the sidecar). */
function collectPresentHunkIds(
  trackHunks: Readonly<Record<string, string>> | undefined,
  layouts: ReadonlyArray<readonly WordLayoutBlock[]>,
): Set<string> {
  const out = new Set<string>();
  if (!trackHunks) {
    return out;
  }
  const remember = (track: WordTrackMark | undefined) => {
    const hunkId = track ? trackHunks[track.id] : undefined;
    if (hunkId) {
      out.add(hunkId);
    }
  };
  const visit = (blocks: readonly WordLayoutBlock[]) => {
    for (const block of blocks) {
      if (block.kind === "paragraph") {
        remember(block.blockTrack);
        for (const run of block.runs) {
          remember(run.track);
        }
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row) {
          remember(cell.rowTrack);
          visit(cell.blocks);
        }
      }
    }
  };
  for (const blocks of layouts) {
    visit(blocks);
  }
  return out;
}

/** Fold an already-accepted hunk into ordinary text. No revision mark is created. */
function applyAcceptedHunk(
  runs: WordRevisionRun[],
  hunk: PaintableHunk,
  anchored: { start: number; end: number },
): WordRevisionRun[] {
  const final = finalText(runs);
  if (
    !hunk.before &&
    hunk.after &&
    final.slice(anchored.start, anchored.start + hunk.after.length) === hunk.after
  ) {
    return runs;
  }
  if (!hunk.before) {
    const at = finalOffsetToAll(runs, anchored.start);
    return replacePlain(runs, at, at, hunk.after);
  }
  const spans = computeMinimalEditSpans(hunk.before, hunk.after);
  if (spans.length === 0) {
    return runs;
  }
  let current = runs;
  for (const span of spans.toReversed()) {
    const start = finalOffsetToAll(current, anchored.start + span.spanStart);
    const end = finalOffsetToAll(current, anchored.start + span.spanEnd);
    current = replacePlain(current, start, end, span.after);
  }
  return current;
}

function applyHunksAsTracks(
  runs: WordRevisionRun[],
  hunks: PaintableHunk[],
  authorName: string,
  trackCtx: TrackContext,
): WordRevisionRun[] {
  if (hunks.length === 0) {
    return runs;
  }
  const cursor = trackCtx.cursor;
  // 每段里的修订也按审阅节奏错开时间；同一个时间戳铺满全文会暴露批量生成。
  const dates = planRevisionTimestamps({
    count: hunks.length,
    seed: hunks.map((hunk) => hunk.hunkId).join("|") || authorName,
  });
  let current = runs;
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.status === "rejected") {
      continue;
    }
    // The file already carries this hunk as w:ins / w:del. Painting it again
    // would insert the text a second time (and grow on every reload).
    if (trackCtx.presentHunkIds?.has(hunk.hunkId)) {
      continue;
    }
    const final = finalText(current);
    const anchored =
      hunk.status === "accepted" ? acceptedAnchor(final, hunk) : revisionAnchor(final, hunk);
    if (!anchored) {
      continue;
    }
    if (hunk.status === "accepted") {
      // Accepted means the mark is gone. Write the result as ordinary text
      // when the original is still in the file; skip when it is already applied.
      current = applyAcceptedHunk(current, hunk, anchored);
      continue;
    }
    // One clock per hunk, seeded above every id already in the document, so
    // two hunks never share a w:id and `reuseInsertion: false` stops an
    // insertion from merging into the previous hunk's mark.
    const firstId = Math.max(cursor.next, maxTrackId(current) + 1);
    const date = dates[index];
    const clock = date
      ? makeAuthorClock(authorName, firstId, date)
      : makeAuthorClock(authorName, firstId);
    if (!hunk.before) {
      const at = finalOffsetToAll(current, anchored.start);
      current = replaceRange(current, at, at, hunk.after, clock, {
        reuseInsertion: false,
      });
    } else {
      const spans = computeMinimalEditSpans(hunk.before, hunk.after);
      for (const span of spans.toReversed()) {
        const start = finalOffsetToAll(current, anchored.start + span.spanStart);
        const end = finalOffsetToAll(current, anchored.start + span.spanEnd);
        current = replaceRange(current, start, end, span.after, clock, {
          reuseInsertion: false,
        });
      }
    }
    const lastId = maxTrackId(current);
    if (lastId >= firstId) {
      const created = new Set<string>();
      for (let id = firstId; id <= lastId; id += 1) {
        created.add(String(id));
      }
      cursor.next = Math.max(cursor.next, lastId + 1);
      current = current.map((run) => {
        if (!run.track || !created.has(run.track.id)) {
          return run;
        }
        return {
          ...run,
          track: { ...run.track, hunkId: hunk.hunkId },
        };
      });
    }
  }
  return current;
}

function paintRevisionRuns(
  runs: WordRevisionRun[],
  colors: Map<string, number>,
): WordSurfaceSegment[] {
  const out: WordSurfaceSegment[] = [];
  const groups = contiguousGroupKeys(runs);
  runs.forEach((run, index) => {
    const groupId = groups[index] || undefined;
    if (run.image) {
      out.push({
        kind: "image" as const,
        src: run.image.src,
        ...(run.image.widthPx != null ? { widthPx: run.image.widthPx } : {}),
        ...(run.image.heightPx != null ? { heightPx: run.image.heightPx } : {}),
        alt: "文档图片",
      });
      return;
    }
    if (run.preservedXml && (!run.text || run.text === "\uFFFC")) {
      return;
    }
    if (!run.track) {
      out.push({ kind: "text" as const, text: run.text, ...run.mark });
      return;
    }
    rememberAuthor(colors, run.track.author);
    out.push({
      kind: "tracked" as const,
      revId: run.track.id,
      change: run.track.kind,
      author: run.track.author,
      text: run.text,
      color: colors.get(run.track.author.trim()) ?? 0,
      ...(run.track.date ? { date: run.track.date } : {}),
      ...(run.track.format ? { format: run.track.format } : {}),
      ...(run.track.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
      ...(run.track.hunkId ? { hunkId: run.track.hunkId } : {}),
      ...(groupId ? { groupId } : {}),
      ...run.mark,
    });
  });
  return out;
}

function layoutFromPlain(texts: string[]): WordLayoutBlock[] {
  return texts.map((text) => ({
    kind: "paragraph" as const,
    runs: text ? [{ text }] : [],
    text,
  }));
}

/** The open file is the page. Baseline text is only used when the file has no paragraphs. */
function fallbackLayout(
  docxParagraphs: string[],
  proposal: RedlineProposal | undefined,
): WordLayoutBlock[] {
  if (docxParagraphs.length > 0) {
    return layoutFromPlain(docxParagraphs);
  }
  const lines = (proposal?.baselineSections ?? [])
    .flatMap((section) => (section.body ?? "").split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean);
  return layoutFromPlain(lines);
}

function flattenParagraphs(blocks: WordSurfaceBlock[]): WordSurfaceParagraph[] {
  const out: WordSurfaceParagraph[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const { kind: _kind, ...paragraph } = block;
      out.push(paragraph);
      continue;
    }
    for (const row of block.rows) {
      for (const cell of row) {
        out.push(...flattenParagraphs(cell.blocks));
      }
    }
  }
  return out;
}

const BODY_PART = "word/document.xml";

/** Assign stable `sourceIndex` (+ optional storyPart) so save can insert new `w:p` rows. */
function stampPartSourceIndexes(blocks: WordSurfaceBlock[], storyPart: string): WordSurfaceBlock[] {
  let index = 0;
  const walk = (list: WordSurfaceBlock[]): WordSurfaceBlock[] =>
    list.map((block) => {
      if (block.kind === "table") {
        return {
          ...block,
          rows: block.rows.map((row) =>
            row.map((cell) => ({ ...cell, blocks: walk(cell.blocks) })),
          ),
        };
      }
      const sourceIndex = index;
      index += 1;
      return { ...block, sourceIndex, storyPart };
    });
  return walk(blocks);
}

function paintStoryLayouts(
  stories: Array<{ part: string; blocks: WordLayoutBlock[] }> | undefined,
  flat: WordLayoutBlock[] | undefined,
  fallbackPart: string,
  colors: Map<string, number>,
  revisionAuthor: string,
  trackCtx: TrackContext,
): WordSurfaceBlock[] | undefined {
  if (stories && stories.length > 0) {
    return stories.flatMap((story) =>
      stampPartSourceIndexes(
        paintLayout(story.blocks, [], new Set(), colors, revisionAuthor, trackCtx),
        story.part,
      ),
    );
  }
  if (flat && flat.length > 0) {
    return stampPartSourceIndexes(
      paintLayout(flat, [], new Set(), colors, revisionAuthor, trackCtx),
      fallbackPart,
    );
  }
  return undefined;
}

function paintLayout(
  blocks: WordLayoutBlock[],
  hunks: PaintableHunk[],
  used: Set<string>,
  colors: Map<string, number>,
  revisionAuthor: string,
  trackCtx: TrackContext,
): WordSurfaceBlock[] {
  return blocks.map((block) => {
    if (block.kind === "table") {
      return {
        kind: "table",
        ...(block.bordered ? { bordered: true } : {}),
        ...(block.widthPx != null ? { widthPx: block.widthPx } : {}),
        ...(block.widthPct != null ? { widthPct: block.widthPct } : {}),
        ...(block.colWidthsPx ? { colWidthsPx: block.colWidthsPx } : {}),
        rows: block.rows.map((row) =>
          row.map((cell) => {
            if (cell.rowTrack) {
              rememberAuthor(colors, cell.rowTrack.author);
            }
            return {
              blocks: paintLayout(cell.blocks, hunks, used, colors, revisionAuthor, trackCtx),
              ...(cell.colspan ? { colspan: cell.colspan } : {}),
              ...(cell.widthPx != null ? { widthPx: cell.widthPx } : {}),
              ...(cell.vertical ? { vertical: true } : {}),
              ...(cell.vAlign ? { vAlign: cell.vAlign } : {}),
              ...(cell.rowTrack
                ? {
                    rowTrack: {
                      revId: cell.rowTrack.id,
                      change: cell.rowTrack.kind,
                      author: cell.rowTrack.author,
                      text: "",
                      color: colors.get(cell.rowTrack.author.trim()) ?? 0,
                      ...(cell.rowTrack.date ? { date: cell.rowTrack.date } : {}),
                    },
                  }
                : {}),
            };
          }),
        ),
      };
    }
    const mine = hunks.filter((hunk) => !used.has(hunk.hunkId) && revisionAnchor(block.text, hunk));
    for (const hunk of mine) {
      used.add(hunk.hunkId);
    }
    const stamped = block.blockTrack
      ? block.runs.map((run) => (run.track ? run : { ...run, track: block.blockTrack }))
      : block.runs;
    const lawyerHunks = mine.filter((hunk) => authorKey(hunk.rationale) === "lawyer");
    const reviewHunks = mine.filter((hunk) => authorKey(hunk.rationale) !== "lawyer");
    let runs = stampTrackHunks(layoutRunsToRevision(stamped), trackCtx.trackHunks);
    runs = applyHunksAsTracks(runs, reviewHunks, revisionAuthor, trackCtx);
    runs = applyHunksAsTracks(runs, lawyerHunks, revisionAuthor, trackCtx);
    for (const author of collectAuthors(runs)) {
      rememberAuthor(colors, author);
    }
    return {
      kind: "paragraph",
      ...(block.align ? { align: block.align } : {}),
      ...(block.indent ? { indent: block.indent } : {}),
      ...(block.firstIndent ? { firstIndent: block.firstIndent } : {}),
      ...(block.spaceBefore ? { spaceBefore: block.spaceBefore } : {}),
      ...(block.spaceAfter ? { spaceAfter: block.spaceAfter } : {}),
      ...(block.line ? { line: block.line } : {}),
      ...(block.fontFamily ? { fontFamily: block.fontFamily } : {}),
      ...(block.listLabel ? { listLabel: block.listLabel } : {}),
      ...(block.outlineLevel != null ? { outlineLevel: block.outlineLevel } : {}),
      ...(block.text ? { baselineText: block.text } : {}),
      ...(block.pPrInner ? { pPrInner: block.pPrInner } : {}),
      runs,
      segments: paintRevisionRuns(runs, colors),
    };
  });
}

function authorKey(rationale: string | undefined): string {
  if (
    rationale === LAWYER_SURFACE_RATIONALE ||
    rationale === MOVE_RATIONALE ||
    rationale?.startsWith(FORMAT_RATIONALE_PREFIX)
  ) {
    return "lawyer";
  }
  const note = rationale?.trim();
  return note ? `review:${note}` : "review";
}

function authorLabel(
  rationale: string | undefined,
  lawyerDisplayName: string | undefined,
  revisionAuthor: string,
): string {
  if (authorKey(rationale) === "lawyer") {
    const name = lawyerDisplayName?.trim();
    return name || revisionAuthor;
  }
  return revisionAuthor;
}

function rememberAuthor(colors: Map<string, number>, key: string): void {
  if (!colors.has(key)) {
    colors.set(key, colors.size % WORD_REVISION_COLOR_COUNT);
  }
}

function collectTrackAuthors(blocks: WordLayoutBlock[], colors: Map<string, number>): void {
  const visit = (list: WordLayoutBlock[]) => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        for (const run of block.runs) {
          const author = run.track?.author?.trim();
          if (author) {
            rememberAuthor(colors, author);
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row) {
          visit(cell.blocks);
        }
      }
    }
  };
  visit(blocks);
}

function balloonToTracked(row: WordRevisionBalloon): WordTrackedView {
  return {
    revId: row.revId,
    ...(row.revIds && row.revIds.length > 0 ? { revIds: row.revIds } : {}),
    change: row.change,
    ...(row.parts && row.parts.length > 1 ? { parts: row.parts } : {}),
    author: row.author,
    text: row.text,
    color: row.color,
    ...(row.date ? { date: row.date } : {}),
    ...(row.format ? { format: row.format } : {}),
    ...(row.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
    ...(row.hunkId ? { hunkId: row.hunkId } : {}),
    ...(row.hunkIds && row.hunkIds.length > 0 ? { hunkIds: row.hunkIds } : {}),
  };
}

function collectTracked(
  blocks: WordSurfaceBlock[],
  colors: Map<string, number>,
): WordTrackedView[] {
  const out: WordTrackedView[] = [];
  const visit = (list: WordSurfaceBlock[]) => {
    for (const block of list) {
      if (block.kind === "table") {
        for (const row of block.rows) {
          const rowMark = row[0]?.rowTrack;
          if (rowMark && out[out.length - 1]?.revId !== rowMark.revId) {
            out.push(rowMark);
          }
          for (const cell of row) {
            visit(cell.blocks);
          }
        }
        continue;
      }
      let adjacent = false;
      if (block.runs && block.runs.length > 0) {
        for (const row of collectBalloons(block.runs, colors)) {
          out.push(balloonToTracked(row));
        }
        continue;
      }
      for (const segment of block.segments) {
        if (segment.kind !== "tracked") {
          adjacent = false;
          continue;
        }
        const prev = out[out.length - 1];
        if (adjacent && prev && prev.revId === segment.revId && prev.change === segment.change) {
          prev.text += segment.text;
        } else {
          out.push({
            revId: segment.revId,
            change: segment.change,
            author: segment.author,
            text: segment.text,
            color: segment.color,
            ...(segment.date ? { date: segment.date } : {}),
            ...(segment.format ? { format: segment.format } : {}),
            ...(segment.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
            ...(segment.hunkId ? { hunkId: segment.hunkId } : {}),
          });
        }
        adjacent = true;
      }
    }
  };
  visit(blocks);
  return out;
}

function isMovedEdit(before: string, after: string, moves: Set<string>): boolean {
  if (moves.size === 0) {
    return false;
  }
  return revisionPieces(before, after).some(
    (piece) => piece.kind === "change" && (moves.has(piece.before) || moves.has(piece.after)),
  );
}

export function composeWordSurface(params: {
  fileName: string;
  relPath: string;
  root: WordBaselineRoot;
  docxParagraphs: string[];
  layout?: WordLayoutBlock[];
  page?: WordPageBox;
  draft?: ArtifactDraft;
  proposal?: RedlineProposal;
  /** Optional override; otherwise read from the workspace identity file. */
  lawyerDisplayName?: string;
  /** Optional override; otherwise read 设置 → 修订署名. */
  wordRevisionAuthor?: string;
  workspaceDir?: string;
  headerLayout?: WordLayoutBlock[];
  footerLayout?: WordLayoutBlock[];
  footnoteLayout?: WordLayoutBlock[];
  /** Prefer per-part stories so save can write the correct header/footer XML. */
  headerStories?: Array<{ part: string; blocks: WordLayoutBlock[] }>;
  footerStories?: Array<{ part: string; blocks: WordLayoutBlock[] }>;
  footnoteStories?: Array<{ part: string; blocks: WordLayoutBlock[] }>;
  docxComments?: WordRevisionComment[];
  /** Track id → hunk id persisted in `word/lawmind-disposition.xml`. */
  trackHunks?: Readonly<Record<string, string>>;
}): WordSurfaceSnapshot {
  const source =
    params.layout && params.layout.length > 0
      ? params.layout
      : fallbackLayout(params.docxParagraphs, params.proposal);
  const sections = params.proposal?.baselineSections ?? [];
  const colors = new Map<string, number>();
  collectTrackAuthors(source, colors);
  for (const story of [
    ...(params.headerStories ?? []),
    ...(params.footerStories ?? []),
    ...(params.footnoteStories ?? []),
  ]) {
    collectTrackAuthors(story.blocks, colors);
  }
  collectTrackAuthors(params.headerLayout ?? [], colors);
  collectTrackAuthors(params.footerLayout ?? [], colors);
  collectTrackAuthors(params.footnoteLayout ?? [], colors);
  const lawyerDisplayName =
    params.lawyerDisplayName?.trim() ||
    (params.workspaceDir ? readLawyerIdentity(params.workspaceDir)?.displayName : undefined) ||
    undefined;
  const revisionAuthor = resolveWordRevisionAuthor(
    params.wordRevisionAuthor ??
      (params.workspaceDir
        ? readWorkspacePolicyFile(params.workspaceDir)?.wordRevisionAuthor
        : undefined),
  );
  const colored = (params.proposal?.hunks ?? []).map((hunk) => ({
    ...hunk,
    color: 0,
    ...(sections[hunk.sectionIndex]?.body != null
      ? { sectionBody: sections[hunk.sectionIndex]?.body }
      : {}),
  }));
  const used = new Set<string>();
  // One id counter for body + headers + footers: Word treats w:id as document-wide.
  let maxExistingId = maxLayoutTrackId(source);
  for (const story of [
    ...(params.headerStories ?? []),
    ...(params.footerStories ?? []),
    ...(params.footnoteStories ?? []),
  ]) {
    maxExistingId = maxLayoutTrackId(story.blocks, maxExistingId);
  }
  maxExistingId = maxLayoutTrackId(params.headerLayout ?? [], maxExistingId);
  maxExistingId = maxLayoutTrackId(params.footerLayout ?? [], maxExistingId);
  maxExistingId = maxLayoutTrackId(params.footnoteLayout ?? [], maxExistingId);
  const trackCtx: TrackContext = {
    cursor: { next: maxExistingId + 1 },
    ...(params.trackHunks ? { trackHunks: params.trackHunks } : {}),
    presentHunkIds: collectPresentHunkIds(params.trackHunks, [
      source,
      ...(params.headerStories ?? []).map((story) => story.blocks),
      ...(params.footerStories ?? []).map((story) => story.blocks),
      ...(params.footnoteStories ?? []).map((story) => story.blocks),
      params.headerLayout ?? [],
      params.footerLayout ?? [],
      params.footnoteLayout ?? [],
    ]),
  };
  const blocks = stampPartSourceIndexes(
    paintLayout(source, colored, used, colors, revisionAuthor, trackCtx),
    BODY_PART,
  );
  const paragraphs = flattenParagraphs(blocks);
  const statusRank: Record<RedlineHunk["status"], number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
  };
  const hunks: WordSurfaceHunkView[] = colored
    .toSorted((a, b) => statusRank[a.status] - statusRank[b.status] || a.color - b.color)
    .map((hunk) => ({
      hunkId: hunk.hunkId,
      before: hunk.before,
      after: hunk.after,
      status: hunk.status,
      color: hunk.color,
      author: authorLabel(hunk.rationale, lawyerDisplayName, revisionAuthor),
      ...(hunk.revisedAt
        ? { revisedAt: hunk.revisedAt }
        : params.proposal?.updatedAt
          ? { revisedAt: params.proposal.updatedAt }
          : {}),
      ...(hunk.rationale ? { rationale: hunk.rationale } : {}),
      ...(hunk.sectionHeading ? { sectionHeading: hunk.sectionHeading } : {}),
      placed: used.has(hunk.hunkId),
    }));
  const page =
    paragraphs.length > 0 ? paragraphs : [{ segments: [{ kind: "text" as const, text: "" }] }];
  const paintedBlocks =
    blocks.length > 0 ? blocks : [{ kind: "paragraph" as const, segments: page[0].segments }];
  const headerBlocks = paintStoryLayouts(
    params.headerStories,
    params.headerLayout,
    "word/header1.xml",
    colors,
    revisionAuthor,
    trackCtx,
  );
  const footerBlocks = paintStoryLayouts(
    params.footerStories,
    params.footerLayout,
    "word/footer1.xml",
    colors,
    revisionAuthor,
    trackCtx,
  );
  const footnoteBlocks = paintStoryLayouts(
    params.footnoteStories,
    params.footnoteLayout,
    "word/footnotes.xml",
    colors,
    revisionAuthor,
    trackCtx,
  );
  const tracked = [
    ...collectTracked(headerBlocks ?? [], colors),
    ...collectTracked(paintedBlocks, colors),
    ...collectTracked(footnoteBlocks ?? [], colors),
    ...collectTracked(footerBlocks ?? [], colors),
  ];
  const hunkViews = hunks.map((hunk) => ({
    ...hunk,
    placed:
      hunk.placed ||
      tracked.some((row) => {
        const ids = row.hunkIds ?? (row.hunkId ? [row.hunkId] : []);
        return ids.length > 0 ? ids.includes(hunk.hunkId) : trackCoversHunk(row, hunk);
      }),
  }));
  const outline = outlineEntriesOf(page);
  return {
    fileName: params.fileName,
    relPath: params.relPath,
    root: params.root,
    taskId: params.draft?.taskId ?? null,
    updatedAt: params.proposal?.updatedAt ?? params.draft?.createdAt ?? null,
    blocks: paintedBlocks,
    paragraphs: page,
    ...(outline.length > 0 ? { outline } : {}),
    page: params.page ?? defaultWordPage(),
    hunks: hunkViews,
    tracked,
    authors: [...new Set(tracked.map((row) => row.author))],
    ...(headerBlocks ? { headerBlocks } : {}),
    ...(footerBlocks ? { footerBlocks } : {}),
    ...(footnoteBlocks ? { footnoteBlocks } : {}),
    ...(params.docxComments && params.docxComments.length > 0
      ? { docxComments: params.docxComments }
      : {}),
    summary: summarizeRedline(params.proposal),
    revisionAuthor,
    ...(lawyerDisplayName ? { lawyerDisplayName } : {}),
  };
}

export async function loadWordSurface(params: {
  workspaceDir: string;
  projectDir?: string;
  root: WordBaselineRoot;
  relPath: string;
  /** When both match the file and the proposal, skip unzipping. */
  seenFileMtime?: number;
  seenProposalAt?: string;
}): Promise<
  | { ok: true; snapshot: WordSurfaceSnapshot }
  | { ok: true; unchanged: true }
  | { ok: false; error: string }
> {
  const relPath = params.relPath.trim().replace(/\\/g, "/");
  const isLegacyDoc = /\.doc$/i.test(relPath) && !/\.docx$/i.test(relPath);
  if (!/\.docx?$/i.test(relPath)) {
    return { ok: false, error: "not_docx" };
  }
  const found = resolveWordBaselineAbs({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    raw: relPath,
    preferredRoot: params.root,
  });
  if (!found || found.root !== params.root) {
    return { ok: false, error: "not_found" };
  }
  let fileMtimeMs: number;
  try {
    fileMtimeMs = Math.round((await fs.stat(found.abs)).mtimeMs);
  } catch {
    return { ok: false, error: "unreadable_docx" };
  }
  const draft = findDraftForWordFile(listDrafts(params.workspaceDir), found.rel);
  const proposal = draft ? readRedlineProposal(params.workspaceDir, draft.taskId) : undefined;
  const proposalAt = proposal?.updatedAt ?? "";
  if (
    params.seenFileMtime != null &&
    params.seenProposalAt != null &&
    params.seenFileMtime === fileMtimeMs &&
    params.seenProposalAt === proposalAt
  ) {
    return { ok: true, unchanged: true };
  }
  let layout: WordLayoutBlock[] = [];
  let paper = defaultWordPage();
  const headerStories: Array<{ part: string; blocks: WordLayoutBlock[] }> = [];
  const footerStories: Array<{ part: string; blocks: WordLayoutBlock[] }> = [];
  const footnoteStories: Array<{ part: string; blocks: WordLayoutBlock[] }> = [];
  let docxComments: WordRevisionComment[] = [];
  let acceptedRevIds: string[] = [];
  let trackHunks: Record<string, string> = {};
  if (isLegacyDoc) {
    // 中栏读 `.doc` 时把文件里已有的修订也标出来：删除显示为删除线，插入标为插入。
    const { readBinaryWordDocWithRevisions } = await import("../mail/read-word-binary.js");
    const source = await readBinaryWordDocWithRevisions(found.abs);
    if (!source.acceptedText.trim() && source.runs.length === 0) {
      return { ok: false, error: "unreadable_doc" };
    }
    const revisionAuthor = (run: { revision?: { author?: string } }) =>
      run.revision?.author ?? "作者";
    layout = source.runs.flatMap((run) => {
      const lines = run.text.split(/[\r\n]+/).filter((line) => line.trim());
      return lines.map((line) => ({
        kind: "paragraph" as const,
        text: line,
        runs: [
          {
            text: line,
            ...(run.revision
              ? {
                  track: {
                    kind: run.revision.kind,
                    id: `${run.revision.cpStart}-${run.revision.cpEnd}`,
                    author: revisionAuthor(run),
                    ...(run.revision.date ? { date: run.revision.date } : {}),
                  },
                }
              : {}),
          },
        ],
      }));
    });
  } else {
    try {
      const stories = await loadDocxStories(found.abs);
      paper = stories.page;
      docxComments = stories.comments;
      acceptedRevIds = stories.acceptedRevIds;
      trackHunks = stories.trackHunks;
      const { hydrateLayoutImages } = await import("./word-revision/hydrate-images.js");
      const imageBudget = { total: 0 };
      for (const story of stories.stories) {
        const relsPath = `word/_rels/${story.part.replace(/^word\//, "")}.rels`;
        const painted = await hydrateLayoutImages(story.blocks, stories.zip, relsPath, imageBudget);
        if (story.role === "body") {
          layout = painted;
        } else if (story.role === "header") {
          headerStories.push({ part: story.part, blocks: painted });
        } else if (story.role === "footer") {
          footerStories.push({ part: story.part, blocks: painted });
        } else {
          footnoteStories.push({ part: story.part, blocks: painted });
        }
      }
    } catch {
      return { ok: false, error: "unreadable_docx" };
    }
  }
  const snapshot = composeWordSurface({
    fileName: path.basename(found.rel),
    relPath: found.rel,
    root: found.root,
    docxParagraphs: [],
    layout,
    page: paper,
    draft,
    proposal,
    workspaceDir: params.workspaceDir,
    ...(headerStories.length > 0 ? { headerStories } : {}),
    ...(footerStories.length > 0 ? { footerStories } : {}),
    ...(footnoteStories.length > 0 ? { footnoteStories } : {}),
    ...(docxComments.length > 0 ? { docxComments } : {}),
    ...(Object.keys(trackHunks).length > 0 ? { trackHunks } : {}),
  });
  return {
    ok: true,
    snapshot: {
      ...applyAcceptedRevisionIds(snapshot, acceptedRevIds),
      fileMtimeMs,
      proposalUpdatedAt: proposalAt,
    },
  };
}

function applyAcceptedRevisionIds(
  snapshot: WordSurfaceSnapshot,
  ids: readonly string[],
): WordSurfaceSnapshot {
  const accepted = new Set(ids);
  if (accepted.size === 0) {
    return snapshot;
  }
  const stampRuns = (runs: WordRevisionRun[] | undefined) =>
    runs ? withAcceptedDisposition(runs, accepted) : runs;
  const stampSegment = (segment: WordSurfaceSegment): WordSurfaceSegment =>
    segment.kind === "tracked" && accepted.has(segment.revId)
      ? { ...segment, disposition: "accepted" }
      : segment;
  const stampParagraph = (paragraph: WordSurfaceParagraph): WordSurfaceParagraph => ({
    ...paragraph,
    ...(paragraph.runs ? { runs: stampRuns(paragraph.runs) } : {}),
    segments: paragraph.segments.map(stampSegment),
  });
  const stampBlocks = (blocks: WordSurfaceBlock[]): WordSurfaceBlock[] =>
    blocks.map((block) => {
      if (block.kind === "table") {
        return {
          ...block,
          rows: block.rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              blocks: stampBlocks(cell.blocks),
              ...(cell.rowTrack && accepted.has(cell.rowTrack.revId)
                ? { rowTrack: { ...cell.rowTrack, disposition: "accepted" as const } }
                : {}),
            })),
          ),
        };
      }
      return { ...stampParagraph(block), kind: "paragraph" };
    });
  return {
    ...snapshot,
    paragraphs: snapshot.paragraphs.map(stampParagraph),
    blocks: stampBlocks(snapshot.blocks),
    ...(snapshot.headerBlocks ? { headerBlocks: stampBlocks(snapshot.headerBlocks) } : {}),
    ...(snapshot.footerBlocks ? { footerBlocks: stampBlocks(snapshot.footerBlocks) } : {}),
    ...(snapshot.footnoteBlocks ? { footnoteBlocks: stampBlocks(snapshot.footnoteBlocks) } : {}),
    tracked: (snapshot.tracked ?? []).map((row) =>
      accepted.has(row.revId) ? { ...row, disposition: "accepted" as const } : row,
    ),
  };
}
