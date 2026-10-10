/**
 * Compare two .docx files and write a tracked-change copy of the base
 * (Word「比较」: base stays the document; other becomes the revision target).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveWordRevisionAuthor } from "../policy/word-revision-author.js";
import { makeAuthorClock, maxTrackId } from "./word-revision/compose.js";
import {
  copyDocx,
  flattenLayoutParagraphs,
  layoutRunToRevision,
  loadDocxStories,
  saveParagraphRuns,
} from "./word-revision/document.js";
import { materializeHunks } from "./word-revision/materialize.js";
import type { WordRevisionRun } from "./word-revision/types.js";
import { extractDocxLayout, type WordLayoutBlock } from "./word-surface-layout.js";

export type ParagraphAlign =
  | { kind: "pair"; baseIndex: number; otherIndex: number }
  | { kind: "base-only"; baseIndex: number }
  | { kind: "other-only"; otherIndex: number };

/**
 * Align paragraphs for compare.
 * LCS on exact paragraph text, then coalesce adjacent delete+insert into substitutions.
 * Equal length is not zipped by index: an insert at the top plus a delete at the bottom
 * would otherwise mark every paragraph as changed.
 */
export function alignParagraphLists(
  base: readonly string[],
  other: readonly string[],
): ParagraphAlign[] {
  const n = base.length;
  const m = other.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (base[i] === other[j]) {
        dp[i][j] = (dp[i + 1][j + 1] ?? 0) + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j] ?? 0, dp[i][j + 1] ?? 0);
      }
    }
  }
  const raw: ParagraphAlign[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      raw.push({ kind: "pair", baseIndex: i, otherIndex: j });
      i += 1;
      j += 1;
    } else if ((dp[i + 1][j] ?? 0) >= (dp[i][j + 1] ?? 0)) {
      raw.push({ kind: "base-only", baseIndex: i });
      i += 1;
    } else {
      raw.push({ kind: "other-only", otherIndex: j });
      j += 1;
    }
  }
  while (i < n) {
    raw.push({ kind: "base-only", baseIndex: i });
    i += 1;
  }
  while (j < m) {
    raw.push({ kind: "other-only", otherIndex: j });
    j += 1;
  }
  return coalesceSubstitutions(raw);
}

/** Turn adjacent delete+insert into a pair so in-place edits keep tracked markup. */
function coalesceSubstitutions(aligned: readonly ParagraphAlign[]): ParagraphAlign[] {
  const out: ParagraphAlign[] = [];
  for (let i = 0; i < aligned.length; i += 1) {
    const a = aligned[i];
    const b = aligned[i + 1];
    if (a?.kind === "base-only" && b?.kind === "other-only") {
      out.push({ kind: "pair", baseIndex: a.baseIndex, otherIndex: b.otherIndex });
      i += 1;
      continue;
    }
    if (a?.kind === "other-only" && b?.kind === "base-only") {
      out.push({ kind: "pair", baseIndex: b.baseIndex, otherIndex: a.otherIndex });
      i += 1;
      continue;
    }
    if (a) {
      out.push(a);
    }
  }
  return out;
}

function allParagraphTexts(blocks: WordLayoutBlock[]): string[] {
  const out: string[] = [];
  const visit = (list: WordLayoutBlock[]) => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        out.push(block.text);
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

async function loadBodyBlocks(absPath: string): Promise<WordLayoutBlock[]> {
  const buffer = await fs.readFile(absPath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  if (!xml) {
    return [];
  }
  const styles = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const numbering = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  return extractDocxLayout(xml, styles, numbering).blocks;
}

export type DocxCompareResult =
  | {
      ok: true;
      outAbs: string;
      outFileName: string;
      changed: number;
      skippedInserts: number;
    }
  | { ok: false; error: string };

/**
 * Copy `baseAbs` to a sibling `*_比较稿.docx` and materialize paragraph diffs
 * from `otherAbs` as tracked revisions on that copy.
 */
export async function writeDocxCompareCopy(params: {
  baseAbs: string;
  otherAbs: string;
  author?: string;
  /** Override output path; default sibling `*_比较稿.docx`. */
  outAbs?: string;
}): Promise<DocxCompareResult> {
  const baseName = path.basename(params.baseAbs);
  if (!/\.docx$/i.test(baseName) || !/\.docx$/i.test(params.otherAbs)) {
    return { ok: false, error: "只能比较两份 .docx。" };
  }
  if (path.resolve(params.baseAbs) === path.resolve(params.otherAbs)) {
    return { ok: false, error: "请选择另一份不同的文件来比较。" };
  }
  const outFileName = baseName.replace(/\.docx$/i, "_比较稿.docx");
  const outAbs = params.outAbs ?? path.join(path.dirname(params.baseAbs), outFileName);

  let baseBlocks: WordLayoutBlock[];
  let otherBlocks: WordLayoutBlock[];
  try {
    baseBlocks = await loadBodyBlocks(params.baseAbs);
    otherBlocks = await loadBodyBlocks(params.otherAbs);
  } catch {
    return { ok: false, error: "读不到其中一份 Word。" };
  }
  const baseTexts = allParagraphTexts(baseBlocks);
  const otherTexts = allParagraphTexts(otherBlocks);
  const aligned = alignParagraphLists(baseTexts, otherTexts);
  const byBase = new Map<number, { other?: string; delete?: boolean }>();
  let skippedInserts = 0;
  for (const row of aligned) {
    if (row.kind === "pair") {
      byBase.set(row.baseIndex, { other: otherTexts[row.otherIndex] });
    } else if (row.kind === "base-only") {
      byBase.set(row.baseIndex, { delete: true });
    } else {
      skippedInserts += 1;
    }
  }

  const copied = await copyDocx(params.baseAbs, outAbs);
  if (!copied.ok) {
    return copied;
  }

  const stories = await loadDocxStories(outAbs);
  const body = stories.stories.find((story) => story.role === "body");
  if (!body) {
    return { ok: false, error: "这份 Word 没有正文。" };
  }
  const layoutParas = flattenLayoutParagraphs(body.blocks);
  let startId = 1;
  const revisionParas: WordRevisionRun[][] = layoutParas.map((runs) =>
    runs.map((run) => layoutRunToRevision(run)),
  );
  for (const runs of revisionParas) {
    startId = Math.max(startId, maxTrackId(runs) + 1);
  }
  const author = makeAuthorClock(resolveWordRevisionAuthor(params.author ?? "比较"), startId);
  let changed = 0;
  const nextParas = revisionParas.map((runs, index) => {
    const plan = byBase.get(index);
    if (!plan) {
      return runs;
    }
    const before = baseTexts[index] ?? "";
    const after = plan.delete ? "" : (plan.other ?? before);
    if (before === after) {
      return runs;
    }
    changed += 1;
    return materializeHunks(runs, [{ before, after }], author);
  });

  const saved = await saveParagraphRuns({ absPath: outAbs, paragraphs: nextParas });
  if (!saved.ok) {
    return saved;
  }
  return { ok: true, outAbs, outFileName, changed, skippedInserts };
}
