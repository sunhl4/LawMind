import fs from "node:fs/promises";
import JSZip from "jszip";
import { resolveWordRevisionAuthor } from "../../policy/word-revision-author.js";
import type { RedlineHunk } from "../redline-proposal.js";
import {
  defaultWordPage,
  extractDocxLayout,
  type WordLayoutBlock,
  type WordLayoutRun,
  type WordPageBox,
} from "../word-surface-layout.js";
import { parseCommentsXml, serializeCommentsXml } from "./comments.js";
import { makeAuthorClock, maxTrackId } from "./compose.js";
import {
  DISPOSITION_PART,
  nextDispositionIds,
  parseDispositionXml,
  serializeDispositionXml,
  trackIdsInDocumentXml,
} from "./disposition.js";
import { materializeHunks } from "./materialize.js";
import type { WordRevisionComment, WordRevisionRun } from "./types.js";
import { replaceParagraphRunsInXml } from "./xml.js";

const PART_NAME = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/;

export type WordRevisionStory = {
  part: string;
  role: "body" | "header" | "footer" | "footnote" | "endnote";
  blocks: WordLayoutBlock[];
};

export async function loadDocxStories(absPath: string): Promise<{
  page: WordPageBox;
  stories: WordRevisionStory[];
  comments: WordRevisionComment[];
  acceptedRevIds: string[];
  zip: JSZip;
}> {
  const zip = await JSZip.loadAsync(await fs.readFile(absPath));
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const numberingXml = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  const layout = extractDocxLayout(documentXml, stylesXml, numberingXml);
  const stories: WordRevisionStory[] = [
    { part: "word/document.xml", role: "body", blocks: layout.blocks },
  ];
  for (const name of Object.keys(zip.files).toSorted()) {
    if (!PART_NAME.test(name) || name === "word/document.xml") {
      continue;
    }
    const xml = await zip.file(name)?.async("string");
    if (!xml) {
      continue;
    }
    const wrapped = wrapStoryAsDocument(xml);
    const storyLayout = extractDocxLayout(wrapped, stylesXml, numberingXml);
    stories.push({
      part: name,
      role: storyRole(name),
      blocks: storyLayout.blocks,
    });
  }
  const commentsXml = (await zip.file("word/comments.xml")?.async("string")) ?? "";
  const dispositionXml = (await zip.file(DISPOSITION_PART)?.async("string")) ?? "";
  return {
    page: layout.page ?? defaultWordPage(),
    stories,
    comments: parseCommentsXml(commentsXml),
    acceptedRevIds: parseDispositionXml(dispositionXml),
    zip,
  };
}

export function layoutRunToRevision(run: WordLayoutRun): WordRevisionRun {
  return {
    text: run.text,
    ...(run.track
      ? {
          track: {
            kind: run.track.kind,
            id: run.track.id,
            author: run.track.author,
            ...(run.track.date ? { date: run.track.date } : {}),
            ...(run.track.moveName ? { moveName: run.track.moveName } : {}),
            ...(run.track.format ? { format: run.track.format } : {}),
          },
        }
      : {}),
    ...markFromRun(run),
    ...(run.commentIds && run.commentIds.length > 0 ? { commentIds: run.commentIds } : {}),
    ...(run.preservedXml ? { preservedXml: run.preservedXml } : {}),
    ...(run.image ? { image: run.image } : {}),
  };
}

export function layoutRunsToRevision(runs: WordLayoutRun[]): WordRevisionRun[] {
  return runs.map(layoutRunToRevision);
}

export function flattenLayoutParagraphs(blocks: WordLayoutBlock[]): WordLayoutRun[][] {
  const out: WordLayoutRun[][] = [];
  const visit = (list: WordLayoutBlock[]) => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        out.push(block.runs);
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
  return out;
}

export function materializeLayoutBlocks(
  blocks: WordLayoutBlock[],
  hunks: readonly Pick<RedlineHunk, "before" | "after" | "status">[],
  authorName: string,
): WordRevisionRun[][] {
  const pending = hunks.filter((hunk) => hunk.status === "pending");
  const paragraphs = flattenLayoutParagraphs(blocks).map(layoutRunsToRevision);
  let startId = 1;
  for (const runs of paragraphs) {
    startId = Math.max(startId, maxTrackId(runs) + 1);
  }
  const author = makeAuthorClock(resolveWordRevisionAuthor(authorName), startId);
  return paragraphs.map((runs) => materializeHunks(runs, pending, author));
}

export type ParagraphRunWrite =
  | WordRevisionRun[]
  | { sourceIndex?: number | null; runs: WordRevisionRun[]; pPrInner?: string };

const STORY_PART_NAME = /^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/;

export async function saveParagraphRuns(params: {
  absPath: string;
  paragraphs: ParagraphRunWrite[];
  /** Header / footer / footnote parts keyed by zip path. */
  stories?: Array<{ part: string; paragraphs: ParagraphRunWrite[] }>;
  comments?: WordRevisionComment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.readFile(params.absPath));
  } catch {
    return { ok: false, error: "读不到这份文件。" };
  }
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    return { ok: false, error: "这份 Word 没有正文。" };
  }
  const writes = params.paragraphs.map((row) => (Array.isArray(row) ? { runs: row } : row));
  const patched = replaceParagraphRunsInXml(documentXml, writes);
  zip.file("word/document.xml", patched.xml);
  const storyTrackIds: string[] = [];
  for (const story of params.stories ?? []) {
    if (!STORY_PART_NAME.test(story.part)) {
      return { ok: false, error: "页眉页脚路径无效。" };
    }
    const storyXml = await zip.file(story.part)?.async("string");
    if (!storyXml) {
      return { ok: false, error: `找不到 ${story.part}。` };
    }
    const storyWrites = story.paragraphs.map((row) => (Array.isArray(row) ? { runs: row } : row));
    const next = replaceParagraphRunsInXml(storyXml, storyWrites);
    zip.file(story.part, next.xml);
    storyTrackIds.push(...trackIdsInDocumentXml(storyXml));
  }
  const previousXml = (await zip.file(DISPOSITION_PART)?.async("string")) ?? "";
  const allRuns = [
    ...writes.map((row) => row.runs),
    ...(params.stories ?? []).flatMap((story) =>
      story.paragraphs.map((row) => (Array.isArray(row) ? row : row.runs)),
    ),
  ];
  const accepted = nextDispositionIds({
    previousAccepted: parseDispositionXml(previousXml),
    previousStoryIds: new Set([...trackIdsInDocumentXml(documentXml), ...storyTrackIds]),
    paragraphs: allRuns,
  });
  zip.file(DISPOSITION_PART, serializeDispositionXml(accepted));
  await ensureDispositionPart(zip);
  if (params.comments) {
    zip.file("word/comments.xml", serializeCommentsXml(params.comments));
    await ensureCommentsPart(zip);
  }
  const out = await zip.generateAsync({ type: "nodebuffer" });
  const tmp = `${params.absPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, out);
    await fs.rename(tmp, params.absPath);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return { ok: false, error: "没能写回这份文件。如果它正在被打开，先关掉再试。" };
  }
  return { ok: true };
}

export async function copyDocx(
  absPath: string,
  destAbs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.copyFile(absPath, destAbs);
    return { ok: true };
  } catch {
    return { ok: false, error: "没能另存这份文件。" };
  }
}

const COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

async function ensureCommentsPart(zip: JSZip): Promise<void> {
  const types = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  if (types && !types.includes('PartName="/word/comments.xml"')) {
    zip.file(
      "[Content_Types].xml",
      types.replace(
        "</Types>",
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_TYPE}"/></Types>`,
      ),
    );
  }
  const relsPath = "word/_rels/document.xml.rels";
  const rels = (await zip.file(relsPath)?.async("string")) ?? "";
  if (rels.includes("comments.xml")) {
    return;
  }
  if (rels) {
    zip.file(
      relsPath,
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdComments" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`,
      ),
    );
    return;
  }
  zip.file(
    relsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdComments" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `</Relationships>`,
  );
}

const DISPOSITION_TYPE = "application/vnd.lawmind.revision-disposition+xml";
const DISPOSITION_REL = "urn:lawmind:relationships:revision-disposition";

async function ensureDispositionPart(zip: JSZip): Promise<void> {
  const types = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  if (types && !types.includes('PartName="/word/lawmind-disposition.xml"')) {
    zip.file(
      "[Content_Types].xml",
      types.replace(
        "</Types>",
        `<Override PartName="/word/lawmind-disposition.xml" ContentType="${DISPOSITION_TYPE}"/></Types>`,
      ),
    );
  }
  const relsPath = "word/_rels/document.xml.rels";
  const rels = (await zip.file(relsPath)?.async("string")) ?? "";
  if (rels.includes("lawmind-disposition.xml")) {
    return;
  }
  const rel = `<Relationship Id="rIdLawmindDisposition" Type="${DISPOSITION_REL}" Target="lawmind-disposition.xml"/>`;
  if (rels) {
    zip.file(relsPath, rels.replace("</Relationships>", `${rel}</Relationships>`));
    return;
  }
  zip.file(
    relsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`,
  );
}

function storyRole(name: string): WordRevisionStory["role"] {
  if (name.includes("header")) {
    return "header";
  }
  if (name.includes("footer")) {
    return "footer";
  }
  if (name.includes("endnotes")) {
    return "endnote";
  }
  if (name.includes("footnotes")) {
    return "footnote";
  }
  return "body";
}

function wrapStoryAsDocument(xml: string): string {
  if (xml.includes("<w:body")) {
    return xml;
  }
  const inner = storyInner(xml);
  return `<w:document><w:body>${inner}</w:body></w:document>`;
}

function storyInner(xml: string): string {
  for (const tag of ["hdr", "ftr", "footnotes", "endnotes"]) {
    const start = xml.indexOf(`<w:${tag}`);
    if (start < 0) {
      continue;
    }
    const openEnd = xml.indexOf(">", start);
    const close = xml.lastIndexOf(`</w:${tag}>`);
    if (openEnd >= 0 && close > openEnd) {
      return xml.slice(openEnd + 1, close);
    }
  }
  return xml;
}

function markFromRun(run: WordLayoutRun): Pick<WordRevisionRun, "mark"> {
  const mark = {
    ...(run.bold ? { bold: true } : {}),
    ...(run.italic ? { italic: true } : {}),
    ...(run.underline ? { underline: true } : {}),
    ...(run.fontSizePx ? { fontSizePx: run.fontSizePx } : {}),
    ...(run.fontColor ? { fontColor: run.fontColor } : {}),
    ...(run.fontFamily ? { fontFamily: run.fontFamily } : {}),
  };
  return Object.keys(mark).length > 0 ? { mark } : {};
}
