/**
 * Chat-middle Word preview: the open .docx plus pending redline hunks painted
 * onto that file's paragraphs. Accept / reject stay on the redline proposal.
 * This is a text preview, not Word's revision track and not a final draft.
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  resolveWordBaselineAbs,
  type WordBaselineRoot,
} from "../artifacts/word-revision-delivery.js";
import type { ArtifactDraft } from "../types.js";
import { listDrafts } from "./index.js";
import {
  readRedlineProposal,
  summarizeRedline,
  type RedlineHunk,
  type RedlineProposal,
} from "./redline-proposal.js";

export type WordSurfaceSegment =
  | { kind: "text"; text: string }
  | {
      kind: "revision";
      hunkId: string;
      before: string;
      after: string;
      rationale?: string;
    };

export type WordSurfaceParagraph = {
  segments: WordSurfaceSegment[];
};

export type WordSurfaceHunkView = {
  hunkId: string;
  before: string;
  after: string;
  status: RedlineHunk["status"];
  rationale?: string;
  sectionHeading?: string;
  /** False when `before` is not in the open file (still decidable from the rail). */
  placed: boolean;
};

export type WordSurfaceSnapshot = {
  fileName: string;
  relPath: string;
  root: WordBaselineRoot;
  taskId: string | null;
  updatedAt: string | null;
  paragraphs: WordSurfaceParagraph[];
  hunks: WordSurfaceHunkView[];
  summary: { pending: number; accepted: number; rejected: number };
  /** File mtime used to skip a repeat unzip. Absent on snapshots built without a file. */
  fileMtimeMs?: number;
  /** Proposal `updatedAt`, or empty when there is no proposal. Matches the unchanged check. */
  proposalUpdatedAt?: string;
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Paragraphs in document order. Empty paragraphs are dropped.
 * Start-tag attributes such as `w14:paraId` are not visible text.
 */
export function extractDocxParagraphsFromXml(xml: string): string[] {
  const paragraphs: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = indexOfWordParagraphOpen(xml, cursor);
    if (start < 0) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, start);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const close = xml.indexOf("</w:p>", openEnd + 1);
    const innerEnd = close >= 0 ? close : xml.length;
    const text = paragraphVisibleText(xml.slice(openEnd + 1, innerEnd));
    if (text) {
      paragraphs.push(text);
    }
    cursor = close >= 0 ? close + "</w:p>".length : xml.length;
  }
  return paragraphs;
}

/** `<w:p` that starts a paragraph, not `w:pPr` / `w:pict` / similar. */
function indexOfWordParagraphOpen(xml: string, from: number): number {
  let cursor = from;
  while (cursor < xml.length) {
    const start = xml.indexOf("<w:p", cursor);
    if (start < 0) {
      return -1;
    }
    const next = xml[start + 4];
    if (next === ">" || next === "/" || (next !== undefined && /\s/u.test(next))) {
      return start;
    }
    cursor = start + 4;
  }
  return -1;
}

/** Index of the `>` that closes the tag at `from`, respecting quoted attribute values. */
function indexOfXmlTagEnd(xml: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      return i;
    }
  }
  return -1;
}

function paragraphVisibleText(inner: string): string {
  return decodeXmlEntities(
    inner
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\u00a0/g, " ")
    .trim();
}

export async function readDocxParagraphs(absPath: string): Promise<string[]> {
  const buffer = await fs.readFile(absPath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) {
    return [];
  }
  return extractDocxParagraphsFromXml(xml);
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

type PaintableHunk = Pick<RedlineHunk, "hunkId" | "before" | "after" | "rationale">;

/** Paint non-overlapping pending revisions onto one paragraph. First match wins. */
export function paintPendingRevisions(text: string, hunks: PaintableHunk[]): WordSurfaceSegment[] {
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
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) {
      continue;
    }
    if (span.start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, span.start) });
    }
    out.push({
      kind: "revision",
      hunkId: span.hunk.hunkId,
      before: span.hunk.before,
      after: span.hunk.after,
      ...(span.hunk.rationale ? { rationale: span.hunk.rationale } : {}),
    });
    cursor = span.end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  if (out.length === 0 && text) {
    out.push({ kind: "text", text });
  }
  return out;
}

/** The open file is the page. Baseline text is only used when the file has no paragraphs. */
function displayParagraphs(
  docxParagraphs: string[],
  proposal: RedlineProposal | undefined,
): string[] {
  if (docxParagraphs.length > 0) {
    return docxParagraphs;
  }
  return (proposal?.baselineSections ?? [])
    .flatMap((section) => (section.body ?? "").split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

export function composeWordSurface(params: {
  fileName: string;
  relPath: string;
  root: WordBaselineRoot;
  docxParagraphs: string[];
  draft?: ArtifactDraft;
  proposal?: RedlineProposal;
}): WordSurfaceSnapshot {
  const paragraphs = displayParagraphs(params.docxParagraphs, params.proposal);
  const pending = (params.proposal?.hunks ?? []).filter((hunk) => hunk.status === "pending");
  const used = new Set<string>();
  const page = paragraphs.map((text) => {
    const mine = pending.filter(
      (hunk) => !used.has(hunk.hunkId) && hunk.before && text.includes(hunk.before),
    );
    for (const hunk of mine) {
      used.add(hunk.hunkId);
    }
    return { segments: paintPendingRevisions(text, mine) };
  });
  const statusRank: Record<RedlineHunk["status"], number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
  };
  const hunks: WordSurfaceHunkView[] = (params.proposal?.hunks ?? [])
    .toSorted((a, b) => statusRank[a.status] - statusRank[b.status])
    .map((hunk) => ({
      hunkId: hunk.hunkId,
      before: hunk.before,
      after: hunk.after,
      status: hunk.status,
      ...(hunk.rationale ? { rationale: hunk.rationale } : {}),
      ...(hunk.sectionHeading ? { sectionHeading: hunk.sectionHeading } : {}),
      placed: hunk.status === "pending" ? used.has(hunk.hunkId) : true,
    }));
  return {
    fileName: params.fileName,
    relPath: params.relPath,
    root: params.root,
    taskId: params.draft?.taskId ?? null,
    updatedAt: params.proposal?.updatedAt ?? params.draft?.createdAt ?? null,
    paragraphs: page.length > 0 ? page : [{ segments: [{ kind: "text", text: "" }] }],
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
  let docxParagraphs: string[] = [];
  try {
    docxParagraphs = await readDocxParagraphs(found.abs);
  } catch {
    return { ok: false, error: "unreadable_docx" };
  }
  const snapshot = composeWordSurface({
    fileName: path.basename(found.rel),
    relPath: found.rel,
    root: found.root,
    docxParagraphs,
    draft,
    proposal,
  });
  return { ok: true, snapshot: { ...snapshot, fileMtimeMs, proposalUpdatedAt: proposalAt } };
}
