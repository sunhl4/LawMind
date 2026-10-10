/**
 * Enough of a .docx to preview like the open file: page size, margins, fonts,
 * line spacing, indents, list labels, and tables. Field instructions stay out
 * of the text.
 *
 * East Asian Word writes both a twip fallback and a line/character unit
 * (`beforeLines`, `firstLineChars`). Word on screen uses the line/character
 * unit. This extractor follows that.
 */

import { decodeXmlEntities, normalizeWordControls, wordSymbolText } from "./word-surface-breaks.js";

export type WordAlign = "left" | "center" | "right" | "both";

/** `em` is a character unit (chars / 100). `line` is a line unit (lines / 100). */
export type WordMeasure =
  | { unit: "px"; value: number }
  | { unit: "em"; value: number }
  | { unit: "line"; value: number };

export type WordLineSpacing =
  | { rule: "auto"; multiple: number }
  | { rule: "exact"; px: number }
  | { rule: "atLeast"; px: number };

export type WordRunMark = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** CSS pixels, from Word half-points at 96dpi. */
  fontSizePx?: number;
  /** `#RRGGBB` from `w:color`, when it is not `auto`. */
  fontColor?: string;
  /** CSS font-family. Latin and East Asian faces are both listed so the browser can pick per glyph. */
  fontFamily?: string;
};

/** Word revision kind. Colors are not stored in the file; the preview assigns them. */
export type WordTrackKind = "ins" | "del" | "moveFrom" | "moveTo" | "format";

export type WordTrackMark = {
  kind: WordTrackKind;
  /** `w:id` from the file. */
  id: string;
  author: string;
  date?: string;
  moveName?: string;
  format?: string;
};

export type WordLayoutRun = {
  text: string;
  track?: WordTrackMark;
  commentIds?: string[];
  /**
   * Full `<w:r>…</w:r>` (or equivalent) kept verbatim on save.
   * Used for drawings, fields, and other non-text runs that serializeRuns
   * cannot rebuild from plain text.
   */
  preservedXml?: string;
  /** Preview data URL filled by hydrateLayoutImages; empty src = placeholder. */
  image?: { src: string; widthPx?: number; heightPx?: number };
} & WordRunMark;

export type WordLayoutParagraph = {
  align?: WordAlign;
  indent?: WordMeasure;
  firstIndent?: WordMeasure;
  spaceBefore?: WordMeasure;
  spaceAfter?: WordMeasure;
  line?: WordLineSpacing;
  fontFamily?: string;
  listLabel?: string;
  /**
   * 1-based outline level for the middle-column outline pane.
   * From `w:outlineLvl`, heading style, or a short Chinese heading pattern.
   */
  outlineLevel?: number;
  runs: WordLayoutRun[];
  text: string;
  /** Whole paragraph sits inside a block-level `w:ins` / `w:del`. */
  blockTrack?: WordTrackMark;
  /** Inner XML of `w:pPr`, kept so save can round-trip. */
  pPrInner?: string;
  /** Paragraph-property revision (`w:pPrChange`). */
  pPrTrack?: WordTrackMark;
};

export type WordLayoutCell = {
  blocks: WordLayoutBlock[];
  colspan?: number;
  widthPx?: number;
  /** Cell text flows top-to-bottom when Word sets `w:textDirection`. */
  vertical?: boolean;
  vAlign?: "top" | "center" | "bottom";
  /** Row insert/delete on `w:trPr`. */
  rowTrack?: WordTrackMark;
};

export type WordLayoutBlock =
  | ({ kind: "paragraph" } & WordLayoutParagraph)
  | {
      kind: "table";
      bordered?: boolean;
      /** Explicit `tblW` in dxa. Percent and auto tables omit this and fill the text column. */
      widthPx?: number;
      widthPct?: number;
      colWidthsPx?: number[];
      rows: WordLayoutCell[][];
    };

/** Paper box. Width includes margins; the text column is width minus left and right. */
export type WordPageBox = {
  widthPx: number;
  marginTopPx: number;
  marginRightPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  fontFamily?: string;
  fontSizePx?: number;
};

export type WordLayoutDocument = {
  page: WordPageBox;
  blocks: WordLayoutBlock[];
};

type StyleRaw = {
  basedOn?: string;
  name?: string;
  type?: string;
  align?: WordAlign;
  fontSizePx?: number;
  fontFamily?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  indent?: WordMeasure;
  firstIndent?: WordMeasure;
  spaceBefore?: WordMeasure;
  spaceAfter?: WordMeasure;
  line?: WordLineSpacing;
  /** OOXML 0-based outline level from the style's `w:pPr`. */
  outlineLvl?: number;
  /** Table style paints a visible grid when the table itself omits `tblBorders`. */
  tableBordered?: boolean;
};

const OUTLINE_HEADING_CHAR_CAP = 40;
const CHINESE_OUTLINE_H1 = /^[一二三四五六七八九十百]+、/;
const CHINESE_OUTLINE_H2 = /^[（(][一二三四五六七八九十\d]+[）)]/;
const CHINESE_OUTLINE_H3 = /^\d+、/;

/** Heading 1–9 from a Word style id or display name. */
export function styleHeadingLevel(styleIdOrName: string | undefined): number | undefined {
  if (!styleIdOrName?.trim()) {
    return undefined;
  }
  const match = /^(?:Heading|heading|标题)\s*([1-9])$/.exec(styleIdOrName.trim());
  if (match?.[1]) {
    return Number(match[1]);
  }
  const compact = /^(?:Heading|heading|标题)([1-9])$/.exec(styleIdOrName.trim());
  if (compact?.[1]) {
    return Number(compact[1]);
  }
  return undefined;
}

/** Short Chinese clause headings used when the doc has no outlineLvl / style. */
export function chineseHeadingLevel(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > OUTLINE_HEADING_CHAR_CAP) {
    return undefined;
  }
  if (trimmed === "免责声明" || CHINESE_OUTLINE_H1.test(trimmed)) {
    return 1;
  }
  if (CHINESE_OUTLINE_H2.test(trimmed)) {
    return 2;
  }
  if (CHINESE_OUTLINE_H3.test(trimmed)) {
    return 3;
  }
  return undefined;
}

/** Resolve a 1-based outline level for a paragraph (undefined = body). */
export function resolveParagraphOutlineLevel(params: {
  pPr: string;
  styleId?: string;
  styleName?: string;
  styleOutlineLvl?: number;
  text: string;
}): number | undefined {
  const direct = params.pPr.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)?.[1];
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n) && n >= 0 && n <= 8) {
      return n + 1;
    }
  }
  if (params.styleOutlineLvl != null && Number.isFinite(params.styleOutlineLvl)) {
    const n = params.styleOutlineLvl;
    if (n >= 0 && n <= 8) {
      return n + 1;
    }
  }
  return (
    styleHeadingLevel(params.styleName) ??
    styleHeadingLevel(params.styleId) ??
    chineseHeadingLevel(params.text)
  );
}

type LevelDef = {
  start: number;
  fmt: string;
  text: string;
  indent?: WordMeasure;
  firstIndent?: WordMeasure;
};

type NumberingModel = {
  abstract: Map<string, Map<number, LevelDef>>;
  num: Map<string, string>;
  counters: Map<string, Array<number | undefined>>;
};

/** Paragraph texts in reading order. Empty paragraphs are omitted. */
export function layoutPlainTexts(blocks: WordLayoutBlock[]): string[] {
  const out: string[] = [];
  const visit = (list: WordLayoutBlock[]) => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        if (block.text) {
          out.push(block.text);
        }
      } else {
        for (const row of block.rows) {
          for (const cell of row) {
            visit(cell.blocks);
          }
        }
      }
    }
  };
  visit(blocks);
  return out;
}

export function extractDocxLayout(
  documentXml: string,
  stylesXml = "",
  numberingXml = "",
): WordLayoutDocument {
  const styles = parseStyles(stylesXml);
  const defaults = parseDocDefaults(stylesXml);
  const numbering = parseNumbering(numberingXml);
  return {
    page: pageBox(documentXml, defaults),
    blocks: simplifyLayout(walkBlocks(sliceBody(documentXml), styles, numbering, defaults)),
  };
}

/** A4 with 2.54cm margins and 宋体 12pt, when the file has no section or defaults. */
export function defaultWordPage(): WordPageBox {
  return {
    widthPx: twipsToPx(11906),
    marginTopPx: twipsToPx(1440),
    marginRightPx: twipsToPx(1440),
    marginBottomPx: twipsToPx(1440),
    marginLeftPx: twipsToPx(1440),
    fontFamily: fontStackFor("SimSun"),
    fontSizePx: 16,
  };
}

/** Borderless one-column frames are cover layout, not grids. Long blank runs are tightened. */
function simplifyLayout(blocks: WordLayoutBlock[]): WordLayoutBlock[] {
  const flat: WordLayoutBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "table") {
      flat.push(block);
      continue;
    }
    const rows = block.rows.map((row) =>
      row.map((cell) => ({
        blocks: simplifyLayout(cell.blocks),
        ...(cell.colspan ? { colspan: cell.colspan } : {}),
        ...(cell.widthPx != null ? { widthPx: cell.widthPx } : {}),
        ...(cell.vertical ? { vertical: true } : {}),
        ...(cell.vAlign ? { vAlign: cell.vAlign } : {}),
        ...(cell.rowTrack ? { rowTrack: cell.rowTrack } : {}),
      })),
    );
    if (!block.bordered && rows.every((row) => row.length <= 1)) {
      for (const row of rows) {
        flat.push(...(row[0]?.blocks ?? []));
      }
      continue;
    }
    flat.push({
      kind: "table",
      ...(block.bordered ? { bordered: true } : {}),
      ...(block.widthPx != null ? { widthPx: block.widthPx } : {}),
      ...(block.widthPct != null ? { widthPct: block.widthPct } : {}),
      ...(block.colWidthsPx ? { colWidthsPx: block.colWidthsPx } : {}),
      rows,
    });
  }
  return collapseBlankParagraphs(flat, 2);
}

function collapseBlankParagraphs(blocks: WordLayoutBlock[], maxRun: number): WordLayoutBlock[] {
  const out: WordLayoutBlock[] = [];
  let blanks = 0;
  for (const block of blocks) {
    if (block.kind === "paragraph" && !block.text.trim()) {
      blanks += 1;
      if (blanks <= maxRun) {
        out.push(block);
      }
      continue;
    }
    blanks = 0;
    out.push(block);
  }
  return out;
}

function sliceBody(xml: string): string {
  const start = xml.indexOf("<w:body");
  if (start < 0) {
    return xml;
  }
  const openEnd = indexOfXmlTagEnd(xml, start);
  if (openEnd < 0) {
    return xml;
  }
  const close = xml.lastIndexOf("</w:body>");
  return xml.slice(openEnd + 1, close >= 0 ? close : xml.length);
}

function walkBlocks(
  xml: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
  defaults: StyleRaw,
): WordLayoutBlock[] {
  const blocks: WordLayoutBlock[] = [];
  const comments: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const paragraphAt = indexOfWordOpen(xml, "p", cursor);
    const tableAt = indexOfWordOpen(xml, "tbl", cursor);
    const limit =
      paragraphAt < 0 && tableAt < 0
        ? xml.length
        : Math.min(
            paragraphAt >= 0 ? paragraphAt : xml.length,
            tableAt >= 0 ? tableAt : xml.length,
          );
    const comment = nextCommentRange(xml, cursor, limit);
    if (comment) {
      applyCommentRange(comments, comment);
      cursor = comment.end;
      continue;
    }
    if (paragraphAt < 0 && tableAt < 0) {
      break;
    }
    const wrapped = nextBlockTrack(xml, cursor, paragraphAt, tableAt);
    if (wrapped) {
      const end = indexOfMatchingClose(xml, wrapped.at, wrapped.name);
      const openEnd = indexOfXmlTagEnd(xml, wrapped.at);
      const inner = xml.slice(openEnd + 1, end - `</w:${wrapped.name}>`.length);
      const openTag = xml.slice(wrapped.at, openEnd + 1);
      const track = trackFromOpenTag(wrapped.name, openTag);
      for (const block of walkBlocks(inner, styles, numbering, defaults)) {
        blocks.push(stampBlockTrack(block, track));
      }
      cursor = end;
      continue;
    }
    const tableFirst = tableAt >= 0 && (paragraphAt < 0 || tableAt < paragraphAt);
    if (tableFirst) {
      const end = indexOfMatchingClose(xml, tableAt, "tbl");
      blocks.push(parseTable(xml.slice(tableAt, end), styles, numbering, defaults));
      cursor = end;
      continue;
    }
    const openEnd = indexOfXmlTagEnd(xml, paragraphAt);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const close = xml.indexOf("</w:p>", openEnd + 1);
    const innerEnd = close >= 0 ? close : xml.length;
    blocks.push(
      parseParagraph(xml.slice(openEnd + 1, innerEnd), styles, numbering, defaults, comments),
    );
    cursor = close >= 0 ? close + "</w:p>".length : xml.length;
  }
  return blocks;
}

function tableIsBordered(tableXml: string, styles: Map<string, StyleRaw>): boolean {
  const tblPr = elementInner(tableXml, "tblPr");
  const borders = elementInner(tblPr, "tblBorders");
  if (borders) {
    if (bordersHaveStroke(borders)) {
      return true;
    }
    if (bordersFullyNil(borders)) {
      return false;
    }
  }
  const styleId = tblPr.match(/<w:tblStyle\b[^>]*w:val="([^"]+)"/)?.[1];
  if (styleId) {
    const style = resolveStyle(styleId, styles);
    if (style.tableBordered) {
      return true;
    }
    const name = (style.name ?? styleId).toLowerCase();
    if (/grid|表格网格|表网格/.test(name) || /grid/i.test(styleId)) {
      return true;
    }
  }
  return bordersHaveStroke(tableXml);
}

const BORDER_EDGE = "top|left|bottom|right|start|end|insideH|insideV";

function bordersHaveStroke(borders: string): boolean {
  return new RegExp(`<w:(?:${BORDER_EDGE})\\b[^>]*w:val="(?!nil|none)[^"]+"`).test(borders);
}

function bordersFullyNil(borders: string): boolean {
  const edges = [...borders.matchAll(/<w:(?:top|left|bottom|right|insideH|insideV)\b[^>]*\/?>/g)];
  return edges.length > 0 && edges.every((edge) => /w:val="(?:nil|none)"/.test(edge[0] ?? ""));
}

function trimEdgeRuns(runs: WordLayoutRun[]): WordLayoutRun[] {
  if (runs.length === 0) {
    return runs;
  }
  const next = runs.map((run) => ({ ...run }));
  const first = next[0];
  const last = next[next.length - 1];
  // Keep line breaks, tabs, and page breaks. They are content, not XML padding.
  if (first) {
    first.text = first.text.replace(/^[^\S\n\t\f]+/u, "");
  }
  if (last) {
    last.text = last.text.replace(/[^\S\n\t\f]+$/u, "");
  }
  return next.filter((run) => run.text.length > 0 || run.track?.kind === "format");
}

function parseTable(
  tableXml: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
  defaults: StyleRaw,
): WordLayoutBlock {
  const bordered = tableIsBordered(tableXml, styles);
  const colWidthsPx = gridWidths(tableXml);
  const width = tableWidth(tableXml);
  const rows: WordLayoutCell[][] = [];
  const openEnd = indexOfXmlTagEnd(tableXml, 0);
  let cursor = openEnd >= 0 ? openEnd + 1 : 0;
  while (cursor < tableXml.length) {
    const rowAt = indexOfWordOpen(tableXml, "tr", cursor);
    if (rowAt < 0) {
      break;
    }
    const rowEnd = indexOfMatchingClose(tableXml, rowAt, "tr");
    rows.push(parseRow(tableXml.slice(rowAt, rowEnd), styles, numbering, defaults, colWidthsPx));
    cursor = rowEnd;
  }
  return {
    kind: "table",
    ...(bordered ? { bordered: true } : {}),
    ...(width?.px != null ? { widthPx: width.px } : {}),
    ...(width?.pct != null ? { widthPct: width.pct } : {}),
    ...(colWidthsPx.length > 0 ? { colWidthsPx } : {}),
    rows,
  };
}

function gridWidths(tableXml: string): number[] {
  const grid = elementInner(tableXml, "tblGrid");
  const widths: number[] = [];
  for (const match of grid.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)) {
    widths.push(twipsToPx(Number(match[1])));
  }
  return widths;
}

function tableWidth(tableXml: string): { px?: number; pct?: number } | undefined {
  const tblPr = elementInner(tableXml, "tblPr");
  const tag = tblPr.match(/<w:tblW\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return undefined;
  }
  const type = tag.match(/\bw:type="([^"]+)"/)?.[1] ?? "dxa";
  const value = numberIn(tag, "w:w");
  if (value == null) {
    return undefined;
  }
  if (type === "pct") {
    return { pct: value / 50 };
  }
  if (type === "dxa") {
    return { px: twipsToPx(value) };
  }
  return undefined;
}

function parseRow(
  rowXml: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
  defaults: StyleRaw,
  colWidthsPx: number[],
): WordLayoutCell[] {
  const cells: WordLayoutCell[] = [];
  const openEnd = indexOfXmlTagEnd(rowXml, 0);
  let cursor = openEnd >= 0 ? openEnd + 1 : 0;
  let col = 0;
  while (cursor < rowXml.length) {
    const cellAt = indexOfWordOpen(rowXml, "tc", cursor);
    if (cellAt < 0) {
      break;
    }
    const cellEnd = indexOfMatchingClose(rowXml, cellAt, "tc");
    const cellOpen = indexOfXmlTagEnd(rowXml, cellAt);
    const inner = rowXml.slice(cellOpen + 1, cellEnd - "</w:tc>".length);
    const tcPr = elementInner(inner, "tcPr");
    const span = numberAttr(tcPr, "gridSpan") ?? 1;
    const widthPx = cellWidthPx(tcPr, colWidthsPx, col, span);
    const vertical = textDirectionVertical(tcPr);
    const vAlign = vAlignOf(tcPr);
    const rowTrack = rowMark(rowXml);
    cells.push({
      blocks: walkBlocks(inner, styles, numbering, defaults),
      ...(span > 1 ? { colspan: span } : {}),
      ...(widthPx != null ? { widthPx } : {}),
      ...(vertical ? { vertical: true } : {}),
      ...(vAlign ? { vAlign } : {}),
      ...(rowTrack ? { rowTrack } : {}),
    });
    col += span;
    cursor = cellEnd;
  }
  return cells;
}

function textDirectionVertical(tcPr: string): boolean {
  const val = tcPr.match(/<w:textDirection\b[^>]*w:val="([^"]+)"/)?.[1];
  if (!val) {
    return false;
  }
  return /^(?:tbRl|btLr|tbLrV|lrTbV|tbRlV|btLrV)$/i.test(val);
}

function vAlignOf(tcPr: string): "top" | "center" | "bottom" | undefined {
  const val = tcPr.match(/<w:vAlign\b[^>]*w:val="([^"]+)"/)?.[1];
  if (val === "top" || val === "center" || val === "bottom") {
    return val;
  }
  return undefined;
}

function cellWidthPx(
  tcPr: string,
  colWidthsPx: number[],
  col: number,
  span: number,
): number | undefined {
  if (colWidthsPx.length > 0) {
    const slice = colWidthsPx.slice(col, col + span);
    if (slice.length > 0) {
      return twipsRound(slice.reduce((sum, width) => sum + width, 0));
    }
  }
  const tag = tcPr.match(/<w:tcW\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return undefined;
  }
  const type = tag.match(/\bw:type="([^"]+)"/)?.[1] ?? "dxa";
  const value = numberIn(tag, "w:w");
  if (value == null || type === "auto" || type === "pct") {
    return undefined;
  }
  return twipsToPx(value);
}

function parseParagraph(
  inner: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
  defaults: StyleRaw,
  inheritedComments: readonly string[] = [],
): WordLayoutBlock {
  const pPr = elementInner(inner, "pPr");
  const styleId = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1];
  const resolved = { ...defaults, ...resolveStyle(styleId, styles) };
  const align = alignOf(pPr) ?? resolved.align;
  const paragraphMark: WordRunMark = {};
  if (resolved.bold) {
    paragraphMark.bold = true;
  }
  if (resolved.italic) {
    paragraphMark.italic = true;
  }
  if (resolved.underline) {
    paragraphMark.underline = true;
  }
  if (resolved.fontSizePx) {
    paragraphMark.fontSizePx = resolved.fontSizePx;
  }
  if (resolved.fontColor) {
    paragraphMark.fontColor = resolved.fontColor;
  }
  if (resolved.fontFamily) {
    paragraphMark.fontFamily = resolved.fontFamily;
  }
  const directMark = markOf(pPr);
  const inherited = { ...paragraphMark, ...directMark };
  const ind = indents(pPr);
  const numId = pPr.match(/<w:numId\b[^>]*w:val="([^"]+)"/)?.[1];
  const ilvl = Number(pPr.match(/<w:ilvl\b[^>]*w:val="(\d+)"/)?.[1] ?? "0");
  const numbered = numId && numId !== "0" ? levelDef(numbering, numId, ilvl) : undefined;
  const pPrTrack = changeTrackOf(pPr, "pPrChange");
  const collected = collectRuns(
    stripFieldInstructions(inner),
    inherited,
    undefined,
    inheritedComments,
  );
  if (pPrTrack) {
    collected.unshift({ text: "", track: pPrTrack });
  }
  const runs = trimEdgeRuns(collected);
  const text = runs
    .filter((run) => run.track?.kind !== "del" && run.track?.kind !== "moveFrom")
    // preservedXml (fldChar / drawing / OLE) keeps a placeholder atom for save;
    // it must not pollute visible paragraph text.
    .map((run) => (run.preservedXml ? "" : run.text))
    .join("");
  const listLabel = numId && numbered ? listLabelFor(numbering, numId, ilvl) : undefined;
  const spacing = spacingOf(pPr);
  const indent = ind.indent ?? numbered?.indent ?? resolved.indent;
  const firstIndent = ind.firstIndent ?? numbered?.firstIndent ?? resolved.firstIndent;
  const spaceBefore = spacing.spaceBefore ?? resolved.spaceBefore;
  const spaceAfter = spacing.spaceAfter ?? resolved.spaceAfter;
  const line = spacing.line ?? resolved.line;
  const outlineLevel = resolveParagraphOutlineLevel({
    pPr,
    styleId,
    styleName: resolved.name,
    styleOutlineLvl: resolved.outlineLvl,
    text,
  });
  return {
    kind: "paragraph",
    ...(align ? { align } : {}),
    ...(indent ? { indent } : {}),
    ...(firstIndent ? { firstIndent } : {}),
    ...(spaceBefore ? { spaceBefore } : {}),
    ...(spaceAfter ? { spaceAfter } : {}),
    ...(line ? { line } : {}),
    ...(inherited.fontFamily ? { fontFamily: inherited.fontFamily } : {}),
    ...(listLabel ? { listLabel } : {}),
    ...(outlineLevel != null ? { outlineLevel } : {}),
    runs,
    text,
    ...(pPr ? { pPrInner: pPr } : {}),
    ...(pPrTrack ? { pPrTrack } : {}),
  };
}

const TRACK_WRAPPERS = ["moveFrom", "moveTo", "ins", "del"] as const;

function nextBlockTrack(
  xml: string,
  cursor: number,
  paragraphAt: number,
  tableAt: number,
): { at: number; name: (typeof TRACK_WRAPPERS)[number] } | null {
  let bestAt = -1;
  let bestName: (typeof TRACK_WRAPPERS)[number] | null = null;
  for (const name of TRACK_WRAPPERS) {
    const at = indexOfWordOpen(xml, name, cursor);
    if (at < 0) {
      continue;
    }
    if (paragraphAt >= 0 && paragraphAt < at) {
      continue;
    }
    if (tableAt >= 0 && tableAt < at) {
      continue;
    }
    if (bestAt < 0 || at < bestAt) {
      bestAt = at;
      bestName = name;
    }
  }
  return bestName && bestAt >= 0 ? { at: bestAt, name: bestName } : null;
}

function trackFromOpenTag(
  name: (typeof TRACK_WRAPPERS)[number],
  openTag: string,
  fallbackId?: string,
): WordTrackMark {
  const author = decodeXmlEntities(attrOf(openTag, "w:author")).trim() || "未知";
  const date = attrOf(openTag, "w:date");
  const moveName = attrOf(openTag, "w:name");
  return {
    kind: name,
    id: attrOf(openTag, "w:id") || fallbackId || name,
    author,
    ...(date ? { date } : {}),
    ...(moveName ? { moveName } : {}),
  };
}

function stampBlockTrack(block: WordLayoutBlock, track: WordTrackMark): WordLayoutBlock {
  if (block.kind === "paragraph") {
    return { ...block, blockTrack: block.blockTrack ?? track, runs: stampRuns(block.runs, track) };
  }
  return {
    ...block,
    rows: block.rows.map((row) =>
      row.map((cell) => ({
        ...cell,
        blocks: cell.blocks.map((inner) => stampBlockTrack(inner, track)),
        rowTrack: cell.rowTrack ?? track,
      })),
    ),
  };
}

function stampRuns(runs: WordLayoutRun[], track: WordTrackMark | undefined): WordLayoutRun[] {
  if (!track) {
    return runs;
  }
  return runs.map((run) => (run.track ? run : { ...run, track }));
}

function rowMark(rowXml: string): WordTrackMark | undefined {
  const trPr = elementInner(rowXml, "trPr");
  if (!trPr) {
    return undefined;
  }
  for (const name of TRACK_WRAPPERS) {
    const at = indexOfWordOpen(trPr, name, 0);
    if (at < 0) {
      continue;
    }
    const openEnd = indexOfXmlTagEnd(trPr, at);
    if (openEnd < 0) {
      continue;
    }
    return trackFromOpenTag(name, trPr.slice(at, openEnd + 1));
  }
  return undefined;
}

function formatTrackOf(rPr: string): WordTrackMark | undefined {
  return changeTrackOf(rPr, "rPrChange");
}

function changeTrackOf(xml: string, tag: "rPrChange" | "pPrChange"): WordTrackMark | undefined {
  if (!xml) {
    return undefined;
  }
  const at = indexOfWordOpen(xml, tag, 0);
  if (at < 0) {
    return undefined;
  }
  const openEnd = indexOfXmlTagEnd(xml, at);
  if (openEnd < 0) {
    return undefined;
  }
  const openTag = xml.slice(at, openEnd + 1);
  const labels: string[] = [];
  if (toggle(xml, "b") === true) {
    labels.push("加粗");
  }
  if (toggle(xml, "i") === true) {
    labels.push("倾斜");
  }
  if (underlineOf(xml) === true) {
    labels.push("下划线");
  }
  return {
    kind: "format",
    id: attrOf(openTag, "w:id") || "format",
    author: decodeXmlEntities(attrOf(openTag, "w:author")).trim() || "未知",
    ...(attrOf(openTag, "w:date") ? { date: attrOf(openTag, "w:date") } : {}),
    format: labels.join("、") || "设置格式",
  };
}

function commentsAt(xml: string, at: number): string[] {
  const open: string[] = [];
  let cursor = 0;
  while (cursor < at) {
    const start = xml.indexOf("<w:commentRangeStart", cursor);
    const endTag = xml.indexOf("<w:commentRangeEnd", cursor);
    if (start < 0 && endTag < 0) {
      break;
    }
    const next = start >= 0 && (endTag < 0 || start < endTag) ? start : endTag;
    if (next < 0 || next >= at) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, next);
    const tag = xml.slice(next, openEnd + 1);
    const id = attrOf(tag, "w:id");
    if (xml.startsWith("<w:commentRangeStart", next)) {
      if (id) {
        open.push(id);
      }
    } else if (id) {
      const index = open.lastIndexOf(id);
      if (index >= 0) {
        open.splice(index, 1);
      }
    }
    cursor = openEnd >= 0 ? openEnd + 1 : next + 1;
  }
  return open;
}

function nextCommentRange(
  xml: string,
  from: number,
  before: number,
): { id: string; start: boolean; end: number } | null {
  const startAt = xml.indexOf("<w:commentRangeStart", from);
  const endAt = xml.indexOf("<w:commentRangeEnd", from);
  const next =
    startAt >= 0 && (endAt < 0 || startAt < endAt)
      ? { at: startAt, start: true }
      : endAt >= 0
        ? { at: endAt, start: false }
        : null;
  if (!next || next.at < 0 || next.at >= before) {
    return null;
  }
  const openEnd = indexOfXmlTagEnd(xml, next.at);
  const id = attrOf(xml.slice(next.at, openEnd + 1), "w:id");
  if (!id) {
    return { id: "", start: next.start, end: openEnd >= 0 ? openEnd + 1 : next.at + 1 };
  }
  return { id, start: next.start, end: openEnd >= 0 ? openEnd + 1 : next.at + 1 };
}

function applyCommentRange(open: string[], comment: { id: string; start: boolean }): void {
  if (!comment.id) {
    return;
  }
  if (comment.start) {
    open.push(comment.id);
    return;
  }
  const index = open.lastIndexOf(comment.id);
  if (index >= 0) {
    open.splice(index, 1);
  }
}

function collectRuns(
  inner: string,
  inherited: WordRunMark,
  parent?: WordTrackMark,
  inheritedComments: readonly string[] = [],
): WordLayoutRun[] {
  const runs: WordLayoutRun[] = [];
  let cursor = 0;
  while (cursor < inner.length) {
    const next = nextRunOrTrack(inner, cursor);
    if (!next) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(inner, next.at);
    if (openEnd < 0) {
      break;
    }
    if (inner[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    if (next.kind === "track") {
      const closeNeedle = `</w:${next.name}>`;
      const end = indexOfMatchingClose(inner, next.at, next.name);
      const openTag = inner.slice(next.at, openEnd + 1);
      const track = trackFromOpenTag(next.name, openTag, `${next.name}-${next.at}`);
      const bodyEnd = Math.max(openEnd + 1, end - closeNeedle.length);
      runs.push(
        ...collectRuns(inner.slice(openEnd + 1, bodyEnd), inherited, track, inheritedComments),
      );
      cursor = end;
      continue;
    }
    const close = inner.indexOf("</w:r>", openEnd + 1);
    const runEnd = close >= 0 ? close + "</w:r>".length : inner.length;
    const runInner = inner.slice(openEnd + 1, close >= 0 ? close : inner.length);
    const text = runVisibleText(runInner);
    const comments = [...new Set([...inheritedComments, ...commentsAt(inner, next.at)])];
    if (text) {
      const rPr = elementInner(runInner, "rPr");
      const format = parent ? undefined : formatTrackOf(rPr);
      runs.push({
        text,
        ...overlayMark(inherited, rPr),
        ...(parent ? { track: parent } : format ? { track: format } : {}),
        ...(comments.length > 0 ? { commentIds: comments } : {}),
      });
    } else if (runHasPreservableContent(runInner)) {
      // Keep drawings / fields / OLE as opaque XML so save does not drop them.
      runs.push({
        text: "\uFFFC",
        preservedXml: inner.slice(next.at, runEnd),
        ...(parent ? { track: parent } : {}),
        ...(comments.length > 0 ? { commentIds: comments } : {}),
      });
    }
    cursor = runEnd;
  }
  return runs;
}

function nextRunOrTrack(
  xml: string,
  from: number,
): { at: number; kind: "run" | "track"; name: (typeof TRACK_WRAPPERS)[number] } | null {
  let bestAt = -1;
  let best: { at: number; kind: "run" | "track"; name: (typeof TRACK_WRAPPERS)[number] } | null =
    null;
  const runAt = indexOfWordOpen(xml, "r", from);
  if (runAt >= 0) {
    bestAt = runAt;
    best = { at: runAt, kind: "run", name: "ins" };
  }
  for (const name of TRACK_WRAPPERS) {
    const at = indexOfWordOpen(xml, name, from);
    if (at >= 0 && (bestAt < 0 || at < bestAt)) {
      bestAt = at;
      best = { at, kind: "track", name };
    }
  }
  return best;
}

function attrOf(openTag: string, name: string): string {
  const needle = `${name}="`;
  const at = openTag.indexOf(needle);
  if (at < 0) {
    return "";
  }
  const start = at + needle.length;
  const end = openTag.indexOf('"', start);
  return end < 0 ? "" : openTag.slice(start, end);
}

/** Non-text run body that must round-trip through serializeRuns unchanged. */
function runHasPreservableContent(runInner: string): boolean {
  return /<w:(drawing|pict|object|oleObject|fldChar|instrText|delInstrText)\b/.test(runInner);
}

function runVisibleText(runInner: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < runInner.length) {
    const token = indexOfRunToken(runInner, cursor);
    if (!token) {
      break;
    }
    const end = indexOfXmlTagEnd(runInner, token.at);
    const open = end >= 0 ? runInner.slice(token.at, end + 1) : "";
    if (token.kind === "tab") {
      out += "\t";
      cursor = end >= 0 ? end + 1 : token.at + 6;
      continue;
    }
    if (token.kind === "br") {
      out += attrOf(open, "w:type") === "page" ? "\f" : "\n";
      cursor = end >= 0 ? end + 1 : token.at + 5;
      continue;
    }
    if (token.kind === "cr") {
      out += "\n";
      cursor = end >= 0 ? end + 1 : token.at + 5;
      continue;
    }
    if (token.kind === "sym") {
      out += wordSymbolText(attrOf(open, "w:font"), attrOf(open, "w:char"));
      cursor = end >= 0 ? end + 1 : token.at + 6;
      continue;
    }
    if (token.kind === "hyphen") {
      out += "\u2011";
      cursor = end >= 0 ? end + 1 : token.at + 16;
      continue;
    }
    if (token.kind === "softHyphen") {
      out += "\u00AD";
      cursor = end >= 0 ? end + 1 : token.at + 13;
      continue;
    }
    const openEnd = end;
    if (openEnd < 0) {
      break;
    }
    if (runInner[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const closeTag = token.kind === "delText" ? "</w:delText>" : "</w:t>";
    const close = runInner.indexOf(closeTag, openEnd + 1);
    const raw = close >= 0 ? runInner.slice(openEnd + 1, close) : "";
    out += decodeXmlEntities(raw);
    cursor = close >= 0 ? close + closeTag.length : runInner.length;
  }
  return normalizeWordControls(out).replace(/\u00a0/g, " ");
}

const RUN_TOKENS = [
  ["noBreakHyphen", "hyphen"],
  ["softHyphen", "softHyphen"],
  ["delText", "delText"],
  ["ptab", "tab"],
  ["tab", "tab"],
  ["br", "br"],
  ["cr", "cr"],
  ["sym", "sym"],
  ["t", "t"],
] as const;

function indexOfRunToken(
  xml: string,
  from: number,
): { at: number; kind: (typeof RUN_TOKENS)[number][1] } | null {
  let cursor = from;
  while (cursor < xml.length) {
    const at = xml.indexOf("<w:", cursor);
    if (at < 0) {
      return null;
    }
    for (const [name, kind] of RUN_TOKENS) {
      const needle = `<w:${name}`;
      if (xml.startsWith(needle, at) && isNameBoundary(xml, at + needle.length)) {
        return { at, kind };
      }
    }
    cursor = at + 3;
  }
  return null;
}

function stripFieldInstructions(inner: string): string {
  return inner
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:delInstrText\b[^>]*>[\s\S]*?<\/w:delInstrText>/g, "");
}

function elementInner(xml: string, name: string): string {
  const start = indexOfWordOpen(xml, name, 0);
  if (start < 0) {
    return "";
  }
  const openEnd = indexOfXmlTagEnd(xml, start);
  if (openEnd < 0 || xml[openEnd - 1] === "/") {
    return "";
  }
  const close = xml.indexOf(`</w:${name}>`, openEnd + 1);
  return close >= 0 ? xml.slice(openEnd + 1, close) : "";
}

function parseStyles(stylesXml: string): Map<string, StyleRaw> {
  const map = new Map<string, StyleRaw>();
  const re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  for (const match of stylesXml.matchAll(re)) {
    const attrs = match[1] ?? "";
    const styleId = attrs.match(/\bw:styleId="([^"]+)"/)?.[1];
    if (!styleId) {
      continue;
    }
    const type = attrs.match(/\bw:type="([^"]+)"/)?.[1];
    const body = match[2] ?? "";
    const name = body.match(/<w:name\b[^>]*w:val="([^"]+)"/)?.[1];
    const basedOn = body.match(/<w:basedOn\b[^>]*w:val="([^"]+)"/)?.[1];
    const pPr = elementInner(body, "pPr");
    const rPr = elementInner(body, "rPr");
    const tblPr = elementInner(body, "tblPr");
    const ind = indents(pPr);
    const spacing = spacingOf(pPr);
    const mark = markOf(rPr);
    const outlineLvlRaw = pPr.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)?.[1];
    const outlineLvl = outlineLvlRaw != null ? Number(outlineLvlRaw) : undefined;
    const noSpace = name === "No Spacing" || name === "无间隔";
    const tableBordered =
      type === "table" && bordersHaveStroke(elementInner(tblPr, "tblBorders") || tblPr);
    map.set(styleId, {
      ...(basedOn ? { basedOn } : {}),
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
      ...(alignOf(pPr) ? { align: alignOf(pPr) } : {}),
      ...(mark.fontSizePx ? { fontSizePx: mark.fontSizePx } : {}),
      ...(mark.fontFamily ? { fontFamily: mark.fontFamily } : {}),
      ...(mark.fontColor ? { fontColor: mark.fontColor } : {}),
      ...(mark.bold ? { bold: true } : {}),
      ...(mark.italic ? { italic: true } : {}),
      ...(mark.underline ? { underline: true } : {}),
      ...(ind.indent ? { indent: ind.indent } : {}),
      ...(ind.firstIndent ? { firstIndent: ind.firstIndent } : {}),
      ...(spacing.spaceBefore ? { spaceBefore: spacing.spaceBefore } : {}),
      ...(spacing.spaceAfter ? { spaceAfter: spacing.spaceAfter } : {}),
      ...(spacing.line ? { line: spacing.line } : {}),
      ...(outlineLvl != null && Number.isFinite(outlineLvl) ? { outlineLvl } : {}),
      ...(tableBordered ? { tableBordered: true } : {}),
      ...(noSpace
        ? {
            spaceBefore: { unit: "px" as const, value: 0 },
            spaceAfter: { unit: "px" as const, value: 0 },
            line: spacing.line ?? { rule: "auto" as const, multiple: 1 },
          }
        : {}),
    });
  }
  return map;
}

function resolveStyle(
  id: string | undefined,
  styles: Map<string, StyleRaw>,
  seen = new Set<string>(),
): StyleRaw {
  if (!id || seen.has(id)) {
    return {};
  }
  seen.add(id);
  const raw = styles.get(id);
  if (!raw) {
    return {};
  }
  const base = resolveStyle(raw.basedOn, styles, seen);
  return {
    ...base,
    ...(raw.align ? { align: raw.align } : {}),
    ...(raw.fontSizePx ? { fontSizePx: raw.fontSizePx } : {}),
    ...(raw.fontFamily ? { fontFamily: raw.fontFamily } : {}),
    ...(raw.fontColor ? { fontColor: raw.fontColor } : {}),
    ...(raw.bold ? { bold: true } : {}),
    ...(raw.italic ? { italic: true } : {}),
    ...(raw.underline ? { underline: true } : {}),
    ...(raw.indent ? { indent: raw.indent } : {}),
    ...(raw.firstIndent ? { firstIndent: raw.firstIndent } : {}),
    ...(raw.spaceBefore ? { spaceBefore: raw.spaceBefore } : {}),
    ...(raw.spaceAfter ? { spaceAfter: raw.spaceAfter } : {}),
    ...(raw.line ? { line: raw.line } : {}),
    ...(raw.outlineLvl != null ? { outlineLvl: raw.outlineLvl } : {}),
    ...(raw.tableBordered ? { tableBordered: true } : {}),
    ...(raw.name ? { name: raw.name } : {}),
    ...(raw.type ? { type: raw.type } : {}),
  };
}

function parseNumbering(numberingXml: string): NumberingModel {
  const abstract = new Map<string, Map<number, LevelDef>>();
  for (const match of numberingXml.matchAll(
    /<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    const levels = new Map<number, LevelDef>();
    for (const lvl of (match[2] ?? "").matchAll(
      /<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g,
    )) {
      const body = lvl[2] ?? "";
      levels.set(Number(lvl[1]), {
        start: numberAttr(body, "start") ?? 1,
        fmt: body.match(/<w:numFmt\b[^>]*w:val="([^"]+)"/)?.[1] ?? "decimal",
        text: decodeXmlEntities(body.match(/<w:lvlText\b[^>]*w:val="([^"]*)"/)?.[1] ?? "%1."),
        ...indents(elementInner(body, "pPr")),
      });
    }
    abstract.set(match[1] ?? "", levels);
  }
  const num = new Map<string, string>();
  for (const match of numberingXml.matchAll(
    /<w:num\b[^>]*w:numId="([^"]+)"[^>]*>([\s\S]*?)<\/w:num>/g,
  )) {
    const abstractId = (match[2] ?? "").match(/<w:abstractNumId\b[^>]*w:val="([^"]+)"/)?.[1];
    if (abstractId) {
      num.set(match[1] ?? "", abstractId);
    }
  }
  return { abstract, num, counters: new Map() };
}

function levelDef(model: NumberingModel, numId: string, ilvl: number): LevelDef | undefined {
  return model.abstract.get(model.num.get(numId) ?? "")?.get(ilvl);
}

function listLabelFor(model: NumberingModel, numId: string, ilvl: number): string {
  const levels = model.abstract.get(model.num.get(numId) ?? "");
  const lvl = levelDef(model, numId, ilvl);
  if (!lvl) {
    return "";
  }
  let counts = model.counters.get(numId);
  if (!counts) {
    counts = [];
    model.counters.set(numId, counts);
  }
  counts[ilvl] = counts[ilvl] == null ? lvl.start : counts[ilvl] + 1;
  for (let deeper = ilvl + 1; deeper < 9; deeper += 1) {
    counts[deeper] = undefined;
  }
  return lvl.text.replace(/%([1-9])/g, (_, raw: string) => {
    const index = Number(raw) - 1;
    const level = levels?.get(index);
    const value = counts?.[index] ?? level?.start ?? 1;
    return formatCount(level?.fmt ?? "decimal", value);
  });
}

function formatCount(fmt: string, n: number): string {
  if (fmt === "bullet") {
    return "•";
  }
  if (fmt === "lowerLetter" || fmt === "upperLetter") {
    const letters = lettersFor(n);
    return fmt === "upperLetter" ? letters.toUpperCase() : letters;
  }
  if (fmt === "lowerRoman" || fmt === "upperRoman") {
    const value = roman(n);
    return fmt === "upperRoman" ? value.toUpperCase() : value;
  }
  if (
    fmt === "japaneseCounting" ||
    fmt === "chineseCounting" ||
    fmt === "chineseCountingThousand"
  ) {
    return japaneseCounting(n);
  }
  return String(n);
}

function lettersFor(n: number): string {
  if (n <= 0) {
    return String(n);
  }
  let value = n;
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function roman(n: number): string {
  if (n <= 0 || n >= 4000) {
    return String(n);
  }
  const pairs: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let value = n;
  let out = "";
  for (const [amount, glyph] of pairs) {
    while (value >= amount) {
      out += glyph;
      value -= amount;
    }
  }
  return out;
}

function japaneseCounting(n: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 0 || n >= 100) {
    return String(n);
  }
  if (n < 10) {
    return digits[n] ?? String(n);
  }
  if (n === 10) {
    return "十";
  }
  if (n < 20) {
    return `十${digits[n % 10] ?? ""}`;
  }
  const tens = digits[Math.floor(n / 10)] ?? "";
  const ones = digits[n % 10] ?? "";
  return `${tens}十${ones}`;
}

function markOf(block: string): WordRunMark {
  return overlayMark({}, block);
}

function overlayMark(base: WordRunMark, block: string): WordRunMark {
  const next: WordRunMark = { ...base };
  applyToggle(next, "bold", toggle(block, "b"));
  applyToggle(next, "italic", toggle(block, "i"));
  applyToggle(next, "underline", underlineOf(block));
  const fontSizePx = fontSizeOf(block);
  if (fontSizePx) {
    next.fontSizePx = fontSizePx;
  }
  const fontColor = fontColorOf(block);
  if (fontColor) {
    next.fontColor = fontColor;
  }
  const fontFamily = fontFamilyOf(block);
  if (fontFamily) {
    next.fontFamily = fontFamily;
  }
  return next;
}

function fontColorOf(block: string): string | undefined {
  const value = block.match(/<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/)?.[1];
  return value ? `#${value}` : undefined;
}

function applyToggle(
  mark: WordRunMark,
  key: "bold" | "italic" | "underline",
  value: boolean | undefined,
): void {
  if (value === true) {
    mark[key] = true;
  } else if (value === false) {
    delete mark[key];
  }
}

function toggle(block: string, tag: string): boolean | undefined {
  const needle = `<w:${tag}`;
  let cursor = 0;
  let found: boolean | undefined;
  while (cursor < block.length) {
    const at = block.indexOf(needle, cursor);
    if (at < 0) {
      break;
    }
    if (!isNameBoundary(block, at + needle.length)) {
      cursor = at + needle.length;
      continue;
    }
    const end = indexOfXmlTagEnd(block, at);
    if (end < 0) {
      break;
    }
    const raw = block.slice(at, end + 1);
    const val = raw.match(/\bw:val="([^"]+)"/)?.[1];
    found = val == null || val === "1" || val === "true" || val === "on";
    cursor = end + 1;
  }
  return found;
}

function underlineOf(block: string): boolean | undefined {
  const needle = "<w:u";
  let cursor = 0;
  let found: boolean | undefined;
  while (cursor < block.length) {
    const at = block.indexOf(needle, cursor);
    if (at < 0) {
      break;
    }
    if (!isNameBoundary(block, at + needle.length)) {
      cursor = at + needle.length;
      continue;
    }
    const end = indexOfXmlTagEnd(block, at);
    if (end < 0) {
      break;
    }
    const val = block.slice(at, end + 1).match(/\bw:val="([^"]+)"/)?.[1];
    found = val !== "none" && val !== "0" && val !== "false";
    cursor = end + 1;
  }
  return found;
}

function fontSizeOf(block: string): number | undefined {
  const match = block.match(/<w:sz\b[^>]*w:val="(\d+)"/);
  if (!match) {
    return undefined;
  }
  const halfPoints = Number(match[1]);
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) {
    return undefined;
  }
  return Math.round((halfPoints / 2) * (96 / 72));
}

function alignOf(block: string): WordAlign | undefined {
  const val = block.match(/<w:jc\b[^>]*w:val="([^"]+)"/)?.[1];
  if (val === "left" || val === "center" || val === "right" || val === "both") {
    return val;
  }
  if (val === "distribute") {
    return "both";
  }
  return undefined;
}

function indents(block: string): { indent?: WordMeasure; firstIndent?: WordMeasure } {
  const tag = block.match(/<w:ind\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return {};
  }
  const leftChars = numberIn(tag, "w:leftChars");
  const left = numberIn(tag, "w:left") ?? numberIn(tag, "w:start");
  const firstChars = numberIn(tag, "w:firstLineChars");
  const first = numberIn(tag, "w:firstLine");
  const hangingChars = numberIn(tag, "w:hangingChars");
  const hanging = numberIn(tag, "w:hanging");
  const out: { indent?: WordMeasure; firstIndent?: WordMeasure } = {};
  if (leftChars != null && leftChars !== 0) {
    out.indent = { unit: "em", value: charsToEm(leftChars) };
  } else if (left != null) {
    out.indent = { unit: "px", value: twipsToPx(left) };
  }
  if (hangingChars != null && hangingChars !== 0) {
    out.firstIndent = { unit: "em", value: -charsToEm(hangingChars) };
  } else if (hanging != null) {
    out.firstIndent = { unit: "px", value: -twipsToPx(hanging) };
  } else if (firstChars != null) {
    out.firstIndent = { unit: "em", value: charsToEm(firstChars) };
  } else if (first != null) {
    out.firstIndent = { unit: "px", value: twipsToPx(first) };
  }
  return out;
}

function spacingOf(block: string): {
  spaceBefore?: WordMeasure;
  spaceAfter?: WordMeasure;
  line?: WordLineSpacing;
} {
  const tag = block.match(/<w:spacing\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return {};
  }
  const beforeLines = numberIn(tag, "w:beforeLines");
  const afterLines = numberIn(tag, "w:afterLines");
  const before = numberIn(tag, "w:before");
  const after = numberIn(tag, "w:after");
  const line = numberIn(tag, "w:line");
  const rule = tag.match(/\bw:lineRule="([^"]+)"/)?.[1];
  const out: { spaceBefore?: WordMeasure; spaceAfter?: WordMeasure; line?: WordLineSpacing } = {};
  if (beforeLines != null) {
    out.spaceBefore = { unit: "line", value: charsToEm(beforeLines) };
  } else if (before != null) {
    out.spaceBefore = { unit: "px", value: twipsToPx(before) };
  }
  if (afterLines != null) {
    out.spaceAfter = { unit: "line", value: charsToEm(afterLines) };
  } else if (after != null) {
    out.spaceAfter = { unit: "px", value: twipsToPx(after) };
  }
  if (line != null && line > 0) {
    if (rule === "exact" || rule === "atLeast") {
      out.line = { rule, px: twipsToPx(line) };
    } else {
      out.line = { rule: "auto", multiple: Math.round((line / 240) * 1000) / 1000 };
    }
  }
  return out;
}

function pageBox(documentXml: string, defaults: StyleRaw): WordPageBox {
  const base = defaultWordPage();
  const sect = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  const pgSz = sect.match(/<w:pgSz\b[^>]*\/?>/)?.[0] ?? "";
  const pgMar = sect.match(/<w:pgMar\b[^>]*\/?>/)?.[0] ?? "";
  const width = numberIn(pgSz, "w:w");
  const top = numberIn(pgMar, "w:top");
  const right = numberIn(pgMar, "w:right");
  const bottom = numberIn(pgMar, "w:bottom");
  const left = numberIn(pgMar, "w:left");
  return {
    widthPx: width != null ? twipsToPx(width) : base.widthPx,
    marginTopPx: top != null ? twipsToPx(top) : base.marginTopPx,
    marginRightPx: right != null ? twipsToPx(right) : base.marginRightPx,
    marginBottomPx: bottom != null ? twipsToPx(bottom) : base.marginBottomPx,
    marginLeftPx: left != null ? twipsToPx(left) : base.marginLeftPx,
    fontFamily: defaults.fontFamily ?? base.fontFamily,
    fontSizePx: defaults.fontSizePx ?? base.fontSizePx,
  };
}

function parseDocDefaults(stylesXml: string): StyleRaw {
  const block = elementInner(stylesXml, "docDefaults");
  if (!block) {
    return {};
  }
  const rPr = elementInner(elementInner(block, "rPrDefault"), "rPr");
  const pPr = elementInner(elementInner(block, "pPrDefault"), "pPr");
  const mark = markOf(rPr);
  const ind = indents(pPr);
  const spacing = spacingOf(pPr);
  return {
    ...(alignOf(pPr) ? { align: alignOf(pPr) } : {}),
    ...(mark.fontSizePx ? { fontSizePx: mark.fontSizePx } : {}),
    ...(mark.fontFamily ? { fontFamily: mark.fontFamily } : {}),
    ...(mark.fontColor ? { fontColor: mark.fontColor } : {}),
    ...(mark.bold ? { bold: true } : {}),
    ...(mark.italic ? { italic: true } : {}),
    ...(mark.underline ? { underline: true } : {}),
    ...(ind.indent ? { indent: ind.indent } : {}),
    ...(ind.firstIndent ? { firstIndent: ind.firstIndent } : {}),
    ...(spacing.spaceBefore ? { spaceBefore: spacing.spaceBefore } : {}),
    ...(spacing.spaceAfter ? { spaceAfter: spacing.spaceAfter } : {}),
    ...(spacing.line ? { line: spacing.line } : {}),
  };
}

function fontFamilyOf(block: string): string | undefined {
  const tag = block.match(/<w:rFonts\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return undefined;
  }
  const east = attrIn(tag, "w:eastAsia");
  const ascii = attrIn(tag, "w:ascii") ?? attrIn(tag, "w:hAnsi");
  if (!east && !ascii) {
    return undefined;
  }
  if (east && ascii && fontKey(east) === fontKey(ascii)) {
    return joinFontFaces([east]);
  }
  const names = [ascii, east].filter((name): name is string => Boolean(name));
  return joinFontFaces(names);
}

function fontKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function joinFontFaces(names: string[]): string {
  const faces: string[] = [];
  let generic = "serif";
  for (const name of names) {
    const mapped = fontFaces(name);
    faces.push(mapped.faces);
    generic = mapped.generic;
  }
  return `${faces.join(", ")}, ${generic}`;
}

function fontFaces(name: string): { faces: string; generic: string } {
  const parts = name
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const mapped = mappedFont(fontKey(part));
      if (mapped) {
        return mapped;
      }
    }
  }
  const key = fontKey(name);
  return (
    mappedFont(key) ?? {
      faces: cssFamily(parts[0] ?? name),
      generic: key === "arial" || key === "calibri" || key === "aptos" ? "sans-serif" : "serif",
    }
  );
}

function mappedFont(key: string): { faces: string; generic: string } | undefined {
  if (
    key === "simsun" ||
    key === "宋体" ||
    key === "nsimsun" ||
    key === "新宋体" ||
    key === "songtisc"
  ) {
    return { faces: 'SimSun, "NSimSun", "Songti SC", "STSong", "Noto Serif SC"', generic: "serif" };
  }
  if (key === "fangsong" || key === "仿宋" || key === "fangsong_gb2312" || key === "仿宋_gb2312") {
    return { faces: '"STFangsong", FangSong, "Songti SC"', generic: "serif" };
  }
  if (key === "kaiti" || key === "楷体" || key === "kaiti_gb2312") {
    return { faces: '"Kaiti SC", "STKaiti", KaiTi', generic: "serif" };
  }
  if (key === "simhei" || key === "黑体") {
    return { faces: '"Heiti SC", "STHeiti", SimHei', generic: "sans-serif" };
  }
  if (key === "microsoftyahei" || key === "微软雅黑" || key === "dengxian" || key === "等线") {
    return { faces: '"PingFang SC", "Microsoft YaHei"', generic: "sans-serif" };
  }
  if (key === "timesnewroman") {
    return { faces: '"Times New Roman", Times', generic: "serif" };
  }
  return undefined;
}

function fontStackFor(name: string): string {
  return joinFontFaces([name]);
}

function cssFamily(name: string): string {
  return /[\s,]|[^\u0020-\u007e]/u.test(name) ? `"${name.replace(/"/g, "")}"` : name;
}

function attrIn(tag: string, attr: string): string | undefined {
  return tag.match(new RegExp(`${attr}="([^"]*)"`))?.[1] || undefined;
}

function charsToEm(chars: number): number {
  return Math.round((chars / 100) * 1000) / 1000;
}

function twipsRound(px: number): number {
  return Math.round(px * 10) / 10;
}

function numberAttr(block: string, tag: string): number | undefined {
  const raw = block.match(new RegExp(`<w:${tag}\\b[^>]*w:val="(-?\\d+)"`))?.[1];
  return raw == null ? undefined : Number(raw);
}

function numberIn(tag: string, attr: string): number | undefined {
  const raw = tag.match(new RegExp(`${attr}="(-?\\d+)"`))?.[1];
  return raw == null ? undefined : Number(raw);
}

function twipsToPx(twips: number): number {
  return Math.round((twips / 15) * 10) / 10;
}

function indexOfWordOpen(xml: string, name: string, from: number): number {
  const needle = `<w:${name}`;
  let cursor = from;
  while (cursor < xml.length) {
    const start = xml.indexOf(needle, cursor);
    if (start < 0) {
      return -1;
    }
    if (isNameBoundary(xml, start + needle.length)) {
      return start;
    }
    cursor = start + needle.length;
  }
  return -1;
}

function isNameBoundary(xml: string, index: number): boolean {
  const next = xml[index];
  return next === ">" || next === "/" || (next !== undefined && /\s/u.test(next));
}

function indexOfMatchingClose(xml: string, openStart: number, name: string): number {
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

function indexOfXmlTagEnd(xml: string, from: number): number {
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
