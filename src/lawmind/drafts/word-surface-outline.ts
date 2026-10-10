/**
 * Browser-safe outline helpers for the desktop Word preview.
 * Keep this free of `node:*` — the renderer value-imports it.
 */

import type { WordSurfaceOutlineEntry, WordSurfaceParagraph } from "./word-surface.js";

function outlineTitleOf(paragraph: WordSurfaceParagraph): string {
  if (paragraph.runs?.length) {
    return paragraph.runs
      .filter((run) => run.track?.kind !== "del" && run.track?.kind !== "moveFrom")
      .map((run) => run.text)
      .join("");
  }
  if (paragraph.baselineText?.trim()) {
    return paragraph.baselineText;
  }
  return paragraph.segments
    .map((seg) => {
      if (seg.kind === "text" || seg.kind === "tracked") {
        return seg.text;
      }
      if (seg.kind === "revision") {
        return seg.after;
      }
      return "";
    })
    .join("");
}

/** Live outline from current paragraph texts (keeps titles fresh after edits). */
export function outlineEntriesOf(
  paragraphs: readonly WordSurfaceParagraph[],
): WordSurfaceOutlineEntry[] {
  const out: WordSurfaceOutlineEntry[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    if (paragraph?.outlineLevel == null) {
      continue;
    }
    const text = outlineTitleOf(paragraph).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) {
      continue;
    }
    out.push({ paragraphIndex, level: paragraph.outlineLevel, text });
  }
  return out;
}
