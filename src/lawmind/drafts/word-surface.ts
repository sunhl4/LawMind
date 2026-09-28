/**
 * Chat-middle Word preview: the open .docx plus pending redline hunks painted
 * onto that file's paragraphs. Accept / reject stay on the redline proposal.
 * This is a text preview, not Word's revision track and not a final draft.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  resolveWordBaselineAbs,
  type WordBaselineRoot,
} from "../artifacts/word-revision-delivery.js";
import type { ArtifactDraft } from "../types.js";
import { listDrafts, persistDraft, readDraft } from "./index.js";
import {
  appendLawyerHunk,
  readRedlineProposal,
  replaceLawyerHunks,
  summarizeRedline,
  type RedlineHunk,
  type RedlineProposal,
} from "./redline-proposal.js";
import {
  extractDocxLayout,
  layoutPlainTexts,
  type WordAlign,
  type WordLayoutBlock,
  type WordLayoutRun,
  type WordRunMark,
} from "./word-surface-layout.js";
import { revisionPieces } from "./word-surface-pieces.js";

/** Stable palette size shared by the page highlight and the right-hand card. */
export const WORD_REVISION_COLOR_COUNT = 8;

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
) &
  WordSurfaceMark;

export type WordSurfaceParagraph = {
  align?: WordAlign;
  indentPx?: number;
  firstIndentPx?: number;
  tight?: boolean;
  listLabel?: string;
  /** Docx text before lawyer edits. Control+S compares the paragraph against this. */
  baselineText?: string;
  segments: WordSurfaceSegment[];
};

export type WordSurfaceBlock =
  | ({ kind: "paragraph" } & WordSurfaceParagraph)
  | { kind: "table"; bordered?: boolean; rows: { blocks: WordSurfaceBlock[] }[][] };

export type WordSurfaceHunkView = {
  hunkId: string;
  before: string;
  after: string;
  status: RedlineHunk["status"];
  rationale?: string;
  sectionHeading?: string;
  /** Palette index. Does not change when the rail reorders by status. */
  color: number;
  /** False when `before` is not in the open file (still decidable from the rail). */
  placed: boolean;
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
  hunks: WordSurfaceHunkView[];
  summary: { pending: number; accepted: number; rejected: number };
  /** File mtime used to skip a repeat unzip. Absent on snapshots built without a file. */
  fileMtimeMs?: number;
  /** Proposal `updatedAt`, or empty when there is no proposal. Matches the unchanged check. */
  proposalUpdatedAt?: string;
};

/**
 * Paragraph texts in document order. Empty paragraphs are dropped.
 * Start-tag attributes and field instructions are not visible text.
 */
export function extractDocxParagraphsFromXml(xml: string): string[] {
  return layoutPlainTexts(extractDocxLayout(xml))
    .map((text) => text.trim())
    .filter(Boolean);
}

export async function readDocxLayout(absPath: string): Promise<WordLayoutBlock[]> {
  const buffer = await fs.readFile(absPath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) {
    return [];
  }
  const styles = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const numbering = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  return extractDocxLayout(xml, styles, numbering);
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
    after: params.after,
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
  return replaceLawyerHunks(
    params.workspaceDir,
    taskId,
    changed.map((row) => ({ before: row.baseline, after: row.current })),
  );
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

type PaintableHunk = Pick<RedlineHunk, "hunkId" | "before" | "after" | "rationale"> & {
  color?: number;
};

type MarkedAtom = { ch: string; mark: WordSurfaceMark };

function sameMark(a: WordSurfaceMark, b: WordSurfaceMark): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.fontSizePx === b.fontSizePx &&
    a.fontColor === b.fontColor
  );
}

function markOfRun(run: WordLayoutRun): WordSurfaceMark {
  const mark: WordSurfaceMark = {};
  if (run.bold) {
    mark.bold = true;
  }
  if (run.italic) {
    mark.italic = true;
  }
  if (run.underline) {
    mark.underline = true;
  }
  if (run.fontSizePx) {
    mark.fontSizePx = run.fontSizePx;
  }
  if (run.fontColor) {
    mark.fontColor = run.fontColor;
  }
  return mark;
}

export { replaceSingleChange, revisionPieces, type RevisionPiece } from "./word-surface-pieces.js";

/** Paint non-overlapping revisions onto one paragraph. First match wins. */
export function paintPendingRevisions(text: string, hunks: PaintableHunk[]): WordSurfaceSegment[] {
  return paintFormattedRuns([{ text }], hunks);
}

export function paintFormattedRuns(
  runs: WordLayoutRun[],
  hunks: PaintableHunk[],
): WordSurfaceSegment[] {
  const atoms: MarkedAtom[] = [];
  for (const run of runs) {
    const mark = markOfRun(run);
    for (const ch of run.text) {
      atoms.push({ ch, mark });
    }
  }
  const text = atoms.map((atom) => atom.ch).join("");
  type Span = { start: number; end: number; hunk: PaintableHunk };
  const spans: Span[] = [];
  for (const hunk of hunks) {
    if (!hunk.before) {
      continue;
    }
    const start = text.indexOf(hunk.before);
    if (start < 0) {
      continue;
    }
    const end = start + hunk.before.length;
    if (spans.some((span) => start < span.end && end > span.start)) {
      continue;
    }
    spans.push({ start, end, hunk });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: WordSurfaceSegment[] = [];
  const pushText = (from: number, to: number) => {
    let start = from;
    while (start < to) {
      let end = start + 1;
      while (end < to && sameMark(atoms[end]?.mark ?? {}, atoms[start]?.mark ?? {})) {
        end += 1;
      }
      const slice = text.slice(start, end);
      if (slice) {
        out.push({ kind: "text", text: slice, ...atoms[start]?.mark });
      }
      start = end;
    }
  };
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) {
      continue;
    }
    if (span.start > cursor) {
      pushText(cursor, span.start);
    }
    const pieces = revisionPieces(span.hunk.before, span.hunk.after);
    const mark = atoms[span.start]?.mark;
    if (pieces.length === 0) {
      pushText(span.start, span.end);
    }
    for (const piece of pieces) {
      if (piece.kind === "text") {
        if (piece.text) {
          out.push({ kind: "text", text: piece.text, ...mark });
        }
        continue;
      }
      out.push({
        kind: "revision",
        hunkId: span.hunk.hunkId,
        before: piece.before,
        after: piece.after,
        ...(span.hunk.rationale ? { rationale: span.hunk.rationale } : {}),
        ...(span.hunk.color != null ? { color: span.hunk.color } : {}),
        ...mark,
      });
    }
    cursor = span.end;
  }
  if (cursor < text.length) {
    pushText(cursor, text.length);
  }
  if (out.length === 0 && text) {
    out.push({ kind: "text", text });
  }
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

function paintLayout(
  blocks: WordLayoutBlock[],
  hunks: PaintableHunk[],
  used: Set<string>,
): WordSurfaceBlock[] {
  return blocks.map((block) => {
    if (block.kind === "table") {
      return {
        kind: "table",
        ...(block.bordered ? { bordered: true } : {}),
        rows: block.rows.map((row) =>
          row.map((cell) => ({ blocks: paintLayout(cell.blocks, hunks, used) })),
        ),
      };
    }
    const mine = hunks.filter(
      (hunk) => !used.has(hunk.hunkId) && hunk.before && block.text.includes(hunk.before),
    );
    for (const hunk of mine) {
      used.add(hunk.hunkId);
    }
    return {
      kind: "paragraph",
      ...(block.align ? { align: block.align } : {}),
      ...(block.indentPx != null ? { indentPx: block.indentPx } : {}),
      ...(block.firstIndentPx != null ? { firstIndentPx: block.firstIndentPx } : {}),
      ...(block.tight ? { tight: true } : {}),
      ...(block.listLabel ? { listLabel: block.listLabel } : {}),
      ...(block.text ? { baselineText: block.text } : {}),
      segments: paintFormattedRuns(block.runs, mine),
    };
  });
}

export function composeWordSurface(params: {
  fileName: string;
  relPath: string;
  root: WordBaselineRoot;
  docxParagraphs: string[];
  layout?: WordLayoutBlock[];
  draft?: ArtifactDraft;
  proposal?: RedlineProposal;
}): WordSurfaceSnapshot {
  const source =
    params.layout && params.layout.length > 0
      ? params.layout
      : fallbackLayout(params.docxParagraphs, params.proposal);
  const colored = (params.proposal?.hunks ?? []).map((hunk, index) => ({
    ...hunk,
    color: index % WORD_REVISION_COLOR_COUNT,
  }));
  const used = new Set<string>();
  const blocks = paintLayout(source, colored, used);
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
      ...(hunk.rationale ? { rationale: hunk.rationale } : {}),
      ...(hunk.sectionHeading ? { sectionHeading: hunk.sectionHeading } : {}),
      placed: used.has(hunk.hunkId),
    }));
  const page =
    paragraphs.length > 0 ? paragraphs : [{ segments: [{ kind: "text" as const, text: "" }] }];
  const paintedBlocks =
    blocks.length > 0 ? blocks : [{ kind: "paragraph" as const, segments: page[0].segments }];
  return {
    fileName: params.fileName,
    relPath: params.relPath,
    root: params.root,
    taskId: params.draft?.taskId ?? null,
    updatedAt: params.proposal?.updatedAt ?? params.draft?.createdAt ?? null,
    blocks: paintedBlocks,
    paragraphs: page,
    hunks,
    summary: summarizeRedline(params.proposal),
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
  if (/\.doc$/i.test(relPath) && !/\.docx$/i.test(relPath)) {
    const { DOC_NEEDS_DOCX_MESSAGE } = await import("../mail/doc-revision-gate.js");
    return { ok: false, error: DOC_NEEDS_DOCX_MESSAGE };
  }
  if (!/\.docx$/i.test(relPath)) {
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
  try {
    layout = await readDocxLayout(found.abs);
  } catch {
    return { ok: false, error: "unreadable_docx" };
  }
  const snapshot = composeWordSurface({
    fileName: path.basename(found.rel),
    relPath: found.rel,
    root: found.root,
    docxParagraphs: [],
    layout,
    draft,
    proposal,
  });
  return { ok: true, snapshot: { ...snapshot, fileMtimeMs, proposalUpdatedAt: proposalAt } };
}
