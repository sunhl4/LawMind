import { serializeWordRunText } from "../word-surface-breaks.js";
import type { WordRevisionRun, WordRevisionTrack } from "./types.js";

export function encodeXml(text: string): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function serializeRuns(runs: WordRevisionRun[]): string {
  const spans = commentSpans(runs);
  const parts: string[] = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    if (!run) {
      break;
    }
    parts.push(...commentStartsAt(spans, index));
    if (!run.track) {
      parts.push(serializePlainRun(run));
      parts.push(...commentEndsAt(spans, index));
      index += 1;
      continue;
    }
    if (run.track.kind === "format") {
      parts.push(serializeFormatRun(run));
      parts.push(...commentEndsAt(spans, index));
      index += 1;
      continue;
    }
    const group: WordRevisionRun[] = [run];
    let cursor = index + 1;
    while (cursor < runs.length) {
      const next = runs[cursor];
      if (!next?.track || next.track.id !== run.track.id || next.track.kind !== run.track.kind) {
        break;
      }
      group.push(next);
      cursor += 1;
    }
    parts.push(serializeTrackGroup(run.track, group));
    for (let i = index; i < cursor; i += 1) {
      parts.push(...commentEndsAt(spans, i));
    }
    index = cursor;
  }
  return parts.join("");
}

export function serializeParagraph(pPrInner: string | undefined, runs: WordRevisionRun[]): string {
  const pPr = pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : "";
  return `<w:p>${pPr}${serializeRuns(runs)}</w:p>`;
}

export type ParagraphWrite = {
  /**
   * Index of the original `w:p` in document order (including tables).
   * `null` = insert a new paragraph after the previous sourced row
   * (or before the first paragraph when it leads the list).
   * Omit for legacy positional replace (row i → `w:p` i, no inserts).
   */
  sourceIndex?: number | null;
  pPrInner?: string;
  runs: WordRevisionRun[];
};

/**
 * Replace run content of each `w:p` in document order (including tables)
 * with serialized runs. Supports inserting new paragraphs via `sourceIndex: null`.
 */
export function replaceParagraphRunsInXml(
  xml: string,
  paragraphs: ParagraphWrite[],
): { xml: string; replaced: number } {
  const hasInserts = paragraphs.some((row) => row.sourceIndex === null);
  if (!hasInserts) {
    let index = 0;
    const next = rewriteParagraphs(xml, (inner) => {
      const row = paragraphs[index];
      index += 1;
      if (!row) {
        return inner;
      }
      return rewriteParagraphInner(inner, row);
    });
    return { xml: next, replaced: Math.min(index, paragraphs.length) };
  }
  return rewriteParagraphsWithInserts(xml, paragraphs);
}

function rewriteParagraphInner(
  inner: string,
  row: Pick<ParagraphWrite, "pPrInner" | "runs">,
): string {
  const pPr = elementInner(inner, "pPr");
  const pPrXml = row.pPrInner != null ? row.pPrInner : pPr;
  const pPrBlock = pPrXml ? `<w:pPr>${pPrXml}</w:pPr>` : "";
  return `${pPrBlock}${serializeRuns(row.runs)}`;
}

/**
 * Insert-aware rewrite: each original `w:p` is replaced by its sourced row;
 * `sourceIndex: null` rows are emitted as new `<w:p>` immediately after the
 * previous sourced paragraph (or before the first `w:p` when they lead).
 */
function rewriteParagraphsWithInserts(
  xml: string,
  paragraphs: ParagraphWrite[],
): { xml: string; replaced: number } {
  const bySource = new Map<number, ParagraphWrite>();
  const insertsAfter = new Map<number, ParagraphWrite[]>();
  let lastSource = -1;
  for (const row of paragraphs) {
    if (row.sourceIndex == null) {
      const list = insertsAfter.get(lastSource) ?? [];
      list.push(row);
      insertsAfter.set(lastSource, list);
      continue;
    }
    bySource.set(row.sourceIndex, row);
    lastSource = row.sourceIndex;
  }

  let out = "";
  let cursor = 0;
  let search = 0;
  let index = 0;
  let replaced = 0;
  let leadingPending = true;
  while (search < xml.length) {
    const start = indexOfWordOpen(xml, "p", search);
    if (start < 0) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, start);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      search = openEnd + 1;
      continue;
    }
    const end = indexOfMatchingClose(xml, start, "p");
    const innerStart = openEnd + 1;
    const innerEnd = end - "</w:p>".length;
    if (leadingPending) {
      out += xml.slice(cursor, start);
      for (const row of insertsAfter.get(-1) ?? []) {
        out += serializeParagraph(row.pPrInner, row.runs);
      }
      leadingPending = false;
      cursor = start;
    }
    out += xml.slice(cursor, innerStart);
    const row = bySource.get(index);
    const inner = xml.slice(innerStart, innerEnd);
    if (row) {
      out += rewriteParagraphInner(inner, row);
      replaced += 1;
    } else {
      out += inner;
    }
    out += xml.slice(innerEnd, end);
    for (const insert of insertsAfter.get(index) ?? []) {
      out += serializeParagraph(insert.pPrInner, insert.runs);
    }
    cursor = end;
    search = end;
    index += 1;
  }
  out += xml.slice(cursor);
  return { xml: out, replaced };
}

function commentSpans(runs: WordRevisionRun[]): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>();
  runs.forEach((run, index) => {
    for (const id of run.commentIds ?? []) {
      const current = spans.get(id);
      if (current) {
        current.end = index;
      } else {
        spans.set(id, { start: index, end: index });
      }
    }
  });
  return spans;
}

function commentStartsAt(
  spans: Map<string, { start: number; end: number }>,
  index: number,
): string[] {
  return [...spans.entries()]
    .filter(([, span]) => span.start === index)
    .map(([id]) => `<w:commentRangeStart w:id="${encodeXml(id)}"/>`);
}

function commentEndsAt(
  spans: Map<string, { start: number; end: number }>,
  index: number,
): string[] {
  return [...spans.entries()]
    .filter(([, span]) => span.end === index)
    .flatMap(([id]) => [
      `<w:commentRangeEnd w:id="${encodeXml(id)}"/>`,
      `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${encodeXml(id)}"/></w:r>`,
    ]);
}

function serializeTrackGroup(track: WordRevisionTrack, runs: WordRevisionRun[]): string {
  const tag = track.kind;
  const date = track.date ? ` w:date="${encodeXml(track.date)}"` : "";
  const move = track.moveName ? ` w:name="${encodeXml(track.moveName)}"` : "";
  const inner = runs.map((run) => serializePlainRun(run, isDeletedKind(track.kind))).join("");
  return `<w:${tag} w:id="${encodeXml(track.id)}" w:author="${encodeXml(track.author)}"${date}${move}>${inner}</w:${tag}>`;
}

function serializeFormatRun(run: WordRevisionRun): string {
  const track = run.track;
  if (!track) {
    return serializePlainRun(run);
  }
  const date = track.date ? ` w:date="${encodeXml(track.date)}"` : "";
  const change = `<w:rPrChange w:id="${encodeXml(track.id)}" w:author="${encodeXml(track.author)}"${date}><w:rPr/></w:rPrChange>`;
  return `<w:r>${rPrXml(run, change)}${serializeWordRunText(run.text, "t")}</w:r>`;
}

function serializePlainRun(run: WordRevisionRun, deleted = false): string {
  if (run.preservedXml) {
    return run.preservedXml;
  }
  const textTag = deleted || isDeletedKind(run.track?.kind) ? "delText" : "t";
  return `<w:r>${rPrXml(run)}${serializeWordRunText(run.text, textTag)}</w:r>`;
}

function rPrXml(run: WordRevisionRun, extra = ""): string {
  const parts: string[] = [extra];
  if (run.mark?.bold) {
    parts.push("<w:b/>");
  }
  if (run.mark?.italic) {
    parts.push("<w:i/>");
  }
  if (run.mark?.underline) {
    parts.push('<w:u w:val="single"/>');
  }
  if (run.mark?.fontSizePx) {
    const half = Math.round((run.mark.fontSizePx * 72) / 96) * 2;
    parts.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  }
  if (run.mark?.fontColor) {
    parts.push(`<w:color w:val="${encodeXml(run.mark.fontColor.replace("#", ""))}"/>`);
  }
  const inner = parts.join("");
  return inner ? `<w:rPr>${inner}</w:rPr>` : "";
}

function isDeletedKind(kind: WordRevisionTrack["kind"] | undefined): boolean {
  return kind === "del" || kind === "moveFrom";
}

function rewriteParagraphs(xml: string, rewrite: (inner: string) => string): string {
  let out = "";
  let cursor = 0;
  let search = 0;
  while (search < xml.length) {
    const start = indexOfWordOpen(xml, "p", search);
    if (start < 0) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, start);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      search = openEnd + 1;
      continue;
    }
    const end = indexOfMatchingClose(xml, start, "p");
    const innerStart = openEnd + 1;
    const innerEnd = end - "</w:p>".length;
    out += xml.slice(cursor, innerStart);
    out += rewrite(xml.slice(innerStart, innerEnd));
    cursor = innerEnd;
    search = end;
  }
  out += xml.slice(cursor);
  return out;
}

export function elementInner(xml: string, name: string): string {
  const start = indexOfWordOpen(xml, name, 0);
  if (start < 0) {
    return "";
  }
  const openEnd = indexOfXmlTagEnd(xml, start);
  if (openEnd < 0) {
    return "";
  }
  if (xml[openEnd - 1] === "/") {
    return "";
  }
  const end = indexOfMatchingClose(xml, start, name);
  return xml.slice(openEnd + 1, end - `</w:${name}>`.length);
}

export function indexOfWordOpen(xml: string, name: string, from: number): number {
  const needle = `<w:${name}`;
  let cursor = from;
  while (cursor < xml.length) {
    const start = xml.indexOf(needle, cursor);
    if (start < 0) {
      return -1;
    }
    const next = xml[start + needle.length];
    if (next === ">" || next === "/" || (next !== undefined && /\s/u.test(next))) {
      return start;
    }
    cursor = start + needle.length;
  }
  return -1;
}

export function indexOfXmlTagEnd(xml: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < xml.length; i += 1) {
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

export function indexOfMatchingClose(xml: string, openStart: number, name: string): number {
  const closeNeedle = `</w:${name}>`;
  let depth = 0;
  let cursor = openStart;
  while (cursor < xml.length) {
    const nextOpen = indexOfWordOpen(xml, name, cursor);
    const nextClose = xml.indexOf(closeNeedle, cursor);
    if (nextClose < 0) {
      return xml.length;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      const openEnd = indexOfXmlTagEnd(xml, nextOpen);
      cursor = openEnd >= 0 ? openEnd + 1 : nextOpen + name.length + 3;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeNeedle.length;
    if (depth === 0) {
      return cursor;
    }
  }
  return xml.length;
}

/**
 * Insert an empty row after `afterRowIndex` in the `tableIndex`-th `w:tbl`
 * (0-based, document order). Cells keep `tcPr`; body is a blank `w:p`.
 */
export function insertEmptyTableRowInXml(
  xml: string,
  tableIndex: number,
  afterRowIndex: number,
): { ok: true; xml: string } | { ok: false; error: string } {
  if (!Number.isInteger(tableIndex) || tableIndex < 0) {
    return { ok: false, error: "invalid_table_index" };
  }
  if (!Number.isInteger(afterRowIndex) || afterRowIndex < 0) {
    return { ok: false, error: "invalid_row_index" };
  }
  const table = locateWordElement(xml, "tbl", tableIndex);
  if (!table) {
    return { ok: false, error: "table_not_found" };
  }
  const tableXml = xml.slice(table.start, table.end);
  const rows: Array<{ start: number; end: number }> = [];
  let rowSearch = 0;
  while (rowSearch < tableXml.length) {
    const rowStart = indexOfWordOpen(tableXml, "tr", rowSearch);
    if (rowStart < 0) {
      break;
    }
    const rowEnd = indexOfMatchingClose(tableXml, rowStart, "tr");
    rows.push({ start: rowStart, end: rowEnd });
    rowSearch = rowEnd;
  }
  const template = rows[afterRowIndex];
  if (!template) {
    return { ok: false, error: "row_not_found" };
  }
  const blank = blankTableRowXml(tableXml.slice(template.start, template.end));
  const insertAt = table.start + template.end;
  return { ok: true, xml: xml.slice(0, insertAt) + blank + xml.slice(insertAt) };
}

/** Nth `w:tbl` / `w:tr` in document order, including tables nested inside cells. */
function locateWordElement(
  xml: string,
  name: string,
  index: number,
): { start: number; end: number } | null {
  let search = 0;
  let seen = 0;
  while (search < xml.length) {
    const start = indexOfWordOpen(xml, name, search);
    if (start < 0) {
      return null;
    }
    const end = indexOfMatchingClose(xml, start, name);
    if (seen === index) {
      return { start, end };
    }
    seen += 1;
    const openEnd = indexOfXmlTagEnd(xml, start);
    search = openEnd >= 0 ? openEnd + 1 : start + 1;
  }
  return null;
}

function blankTableRowXml(rowXml: string): string {
  const openEnd = indexOfXmlTagEnd(rowXml, 0);
  if (openEnd < 0) {
    return "<w:tr><w:tc><w:p/></w:tc></w:tr>";
  }
  const trOpen = rowXml.slice(0, openEnd + 1);
  const trPr = elementInner(rowXml, "trPr");
  let out = trOpen;
  if (trPr) {
    const cleanedPr = trPr
      .replace(/<w:ins\b[^/]*\/>/g, "")
      .replace(/<w:del\b[^/]*\/>/g, "")
      .replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, "")
      .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "");
    if (cleanedPr.trim()) {
      out += `<w:trPr>${cleanedPr}</w:trPr>`;
    }
  }
  let search = 0;
  let cellCount = 0;
  while (search < rowXml.length) {
    const cellStart = indexOfWordOpen(rowXml, "tc", search);
    if (cellStart < 0) {
      break;
    }
    const cellOpenEnd = indexOfXmlTagEnd(rowXml, cellStart);
    const cellEnd = indexOfMatchingClose(rowXml, cellStart, "tc");
    const cellInner = rowXml.slice(cellOpenEnd + 1, cellEnd - "</w:tc>".length);
    const tcPr = elementInner(cellInner, "tcPr");
    out += tcPr ? `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p/></w:tc>` : `<w:tc><w:p/></w:tc>`;
    cellCount += 1;
    search = cellEnd;
  }
  if (cellCount === 0) {
    out += "<w:tc><w:p/></w:tc>";
  }
  return `${out}</w:tr>`;
}
