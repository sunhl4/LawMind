/**
 * Enough of a .docx to preview like the open file: alignment, size, bold,
 * indents, list labels, and tables. Field instructions stay out of the text.
 */

export type WordAlign = "left" | "center" | "right" | "both";

export type WordRunMark = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** CSS pixels, from Word half-points. */
  fontSizePx?: number;
  /** `#RRGGBB` from `w:color`, when it is not `auto`. */
  fontColor?: string;
};

export type WordLayoutRun = { text: string } & WordRunMark;

export type WordLayoutParagraph = {
  align?: WordAlign;
  indentPx?: number;
  firstIndentPx?: number;
  /** No-spacing styles keep cover lines from opening a full paragraph gap. */
  tight?: boolean;
  listLabel?: string;
  runs: WordLayoutRun[];
  text: string;
};

export type WordLayoutBlock =
  | ({ kind: "paragraph" } & WordLayoutParagraph)
  | { kind: "table"; bordered?: boolean; rows: { blocks: WordLayoutBlock[] }[][] };

type StyleRaw = {
  basedOn?: string;
  name?: string;
  align?: WordAlign;
  fontSizePx?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  indentPx?: number;
  firstIndentPx?: number;
  tight?: boolean;
};

type LevelDef = { start: number; fmt: string; text: string };

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
): WordLayoutBlock[] {
  const styles = parseStyles(stylesXml);
  const numbering = parseNumbering(numberingXml);
  return simplifyLayout(walkBlocks(sliceBody(documentXml), styles, numbering));
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
      row.map((cell) => ({ blocks: simplifyLayout(cell.blocks) })),
    );
    if (!block.bordered && rows.every((row) => row.length <= 1)) {
      for (const row of rows) {
        flat.push(...(row[0]?.blocks ?? []));
      }
      continue;
    }
    flat.push({ kind: "table", ...(block.bordered ? { bordered: true } : {}), rows });
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
): WordLayoutBlock[] {
  const blocks: WordLayoutBlock[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const paragraphAt = indexOfWordOpen(xml, "p", cursor);
    const tableAt = indexOfWordOpen(xml, "tbl", cursor);
    if (paragraphAt < 0 && tableAt < 0) {
      break;
    }
    const tableFirst = tableAt >= 0 && (paragraphAt < 0 || tableAt < paragraphAt);
    if (tableFirst) {
      const end = indexOfMatchingClose(xml, tableAt, "tbl");
      blocks.push(parseTable(xml.slice(tableAt, end), styles, numbering));
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
    blocks.push(parseParagraph(xml.slice(openEnd + 1, innerEnd), styles, numbering));
    cursor = close >= 0 ? close + "</w:p>".length : xml.length;
  }
  return blocks;
}

function tableIsBordered(tableXml: string): boolean {
  const borders = elementInner(elementInner(tableXml, "tblPr"), "tblBorders");
  if (!borders) {
    return false;
  }
  return /<w:(?:top|left|bottom|right|insideH|insideV)\b[^>]*w:val="(?!nil|none)[^"]+"/.test(
    borders,
  );
}

function trimEdgeRuns(runs: WordLayoutRun[]): WordLayoutRun[] {
  if (runs.length === 0) {
    return runs;
  }
  const next = runs.map((run) => ({ ...run }));
  const first = next[0];
  const last = next[next.length - 1];
  if (first) {
    first.text = first.text.replace(/^\s+/u, "");
  }
  if (last) {
    last.text = last.text.replace(/\s+$/u, "");
  }
  return next.filter((run) => run.text.length > 0);
}

function parseTable(
  tableXml: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
): WordLayoutBlock {
  const bordered = tableIsBordered(tableXml);
  const rows: { blocks: WordLayoutBlock[] }[][] = [];
  const openEnd = indexOfXmlTagEnd(tableXml, 0);
  let cursor = openEnd >= 0 ? openEnd + 1 : 0;
  while (cursor < tableXml.length) {
    const rowAt = indexOfWordOpen(tableXml, "tr", cursor);
    if (rowAt < 0) {
      break;
    }
    const rowEnd = indexOfMatchingClose(tableXml, rowAt, "tr");
    rows.push(parseRow(tableXml.slice(rowAt, rowEnd), styles, numbering));
    cursor = rowEnd;
  }
  return { kind: "table", ...(bordered ? { bordered: true } : {}), rows };
}

function parseRow(
  rowXml: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
): { blocks: WordLayoutBlock[] }[] {
  const cells: { blocks: WordLayoutBlock[] }[] = [];
  const openEnd = indexOfXmlTagEnd(rowXml, 0);
  let cursor = openEnd >= 0 ? openEnd + 1 : 0;
  while (cursor < rowXml.length) {
    const cellAt = indexOfWordOpen(rowXml, "tc", cursor);
    if (cellAt < 0) {
      break;
    }
    const cellEnd = indexOfMatchingClose(rowXml, cellAt, "tc");
    const cellOpen = indexOfXmlTagEnd(rowXml, cellAt);
    const inner = rowXml.slice(cellOpen + 1, cellEnd - "</w:tc>".length);
    cells.push({ blocks: walkBlocks(inner, styles, numbering) });
    cursor = cellEnd;
  }
  return cells;
}

function parseParagraph(
  inner: string,
  styles: Map<string, StyleRaw>,
  numbering: NumberingModel,
): WordLayoutBlock {
  const pPr = elementInner(inner, "pPr");
  const styleId = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1];
  const resolved = resolveStyle(styleId, styles);
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
  const directMark = markOf(pPr);
  const inherited = { ...paragraphMark, ...directMark };
  const ind = indents(pPr);
  const runs = trimEdgeRuns(collectRuns(stripFieldInstructions(inner), inherited));
  const text = runs.map((run) => run.text).join("");
  const numId = pPr.match(/<w:numId\b[^>]*w:val="([^"]+)"/)?.[1];
  const ilvlRaw = pPr.match(/<w:ilvl\b[^>]*w:val="(\d+)"/)?.[1];
  const listLabel =
    numId && numId !== "0"
      ? listLabelFor(numbering, numId, ilvlRaw ? Number(ilvlRaw) : 0)
      : undefined;
  const indentPx = ind.indentPx ?? resolved.indentPx;
  const firstIndentPx = ind.firstIndentPx ?? resolved.firstIndentPx;
  return {
    kind: "paragraph",
    ...(align ? { align } : {}),
    ...(indentPx != null ? { indentPx } : {}),
    ...(firstIndentPx != null ? { firstIndentPx } : {}),
    ...(resolved.tight || /<w:spacing\b[^>]*w:before="0"[^>]*w:after="0"/.test(pPr)
      ? { tight: true }
      : {}),
    ...(listLabel ? { listLabel } : {}),
    runs,
    text,
  };
}

function collectRuns(inner: string, inherited: WordRunMark): WordLayoutRun[] {
  const runs: WordLayoutRun[] = [];
  let cursor = 0;
  while (cursor < inner.length) {
    const start = indexOfWordOpen(inner, "r", cursor);
    if (start < 0) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(inner, start);
    if (openEnd < 0) {
      break;
    }
    if (inner[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const close = inner.indexOf("</w:r>", openEnd + 1);
    const runInner = inner.slice(openEnd + 1, close >= 0 ? close : inner.length);
    const text = runVisibleText(runInner);
    if (text) {
      runs.push({ text, ...overlayMark(inherited, elementInner(runInner, "rPr")) });
    }
    cursor = close >= 0 ? close + "</w:r>".length : inner.length;
  }
  return runs;
}

function runVisibleText(runInner: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < runInner.length) {
    const token = indexOfRunToken(runInner, cursor);
    if (!token) {
      break;
    }
    if (token.kind === "tab") {
      out += "\t";
      const end = indexOfXmlTagEnd(runInner, token.at);
      cursor = end >= 0 ? end + 1 : token.at + 6;
      continue;
    }
    if (token.kind === "br") {
      out += "\n";
      const end = indexOfXmlTagEnd(runInner, token.at);
      cursor = end >= 0 ? end + 1 : token.at + 5;
      continue;
    }
    const openEnd = indexOfXmlTagEnd(runInner, token.at);
    if (openEnd < 0) {
      break;
    }
    if (runInner[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const close = runInner.indexOf("</w:t>", openEnd + 1);
    const raw = close >= 0 ? runInner.slice(openEnd + 1, close) : "";
    out += decodeXmlEntities(raw);
    cursor = close >= 0 ? close + "</w:t>".length : runInner.length;
  }
  return out.replace(/\u00a0/g, " ");
}

function indexOfRunToken(
  xml: string,
  from: number,
): { at: number; kind: "t" | "tab" | "br" } | null {
  let cursor = from;
  while (cursor < xml.length) {
    const at = xml.indexOf("<w:", cursor);
    if (at < 0) {
      return null;
    }
    if (xml.startsWith("<w:tab", at) && isNameBoundary(xml, at + 6)) {
      return { at, kind: "tab" };
    }
    if (xml.startsWith("<w:br", at) && isNameBoundary(xml, at + 5)) {
      return { at, kind: "br" };
    }
    if (xml.startsWith("<w:t", at) && isNameBoundary(xml, at + 4)) {
      return { at, kind: "t" };
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
  const re = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  for (const match of stylesXml.matchAll(re)) {
    const body = match[2] ?? "";
    const name = body.match(/<w:name\b[^>]*w:val="([^"]+)"/)?.[1];
    const basedOn = body.match(/<w:basedOn\b[^>]*w:val="([^"]+)"/)?.[1];
    const pPr = elementInner(body, "pPr");
    const rPr = elementInner(body, "rPr");
    const ind = indents(pPr);
    const mark = markOf(rPr);
    map.set(match[1] ?? "", {
      ...(basedOn ? { basedOn } : {}),
      ...(name ? { name } : {}),
      ...(alignOf(pPr) ? { align: alignOf(pPr) } : {}),
      ...(mark.fontSizePx ? { fontSizePx: mark.fontSizePx } : {}),
      ...(mark.bold ? { bold: true } : {}),
      ...(mark.italic ? { italic: true } : {}),
      ...(mark.underline ? { underline: true } : {}),
      ...(mark.fontColor ? { fontColor: mark.fontColor } : {}),
      ...(ind.indentPx != null ? { indentPx: ind.indentPx } : {}),
      ...(ind.firstIndentPx != null ? { firstIndentPx: ind.firstIndentPx } : {}),
      ...(name === "No Spacing" || name === "无间隔" ? { tight: true } : {}),
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
    ...(raw.bold ? { bold: true } : {}),
    ...(raw.italic ? { italic: true } : {}),
    ...(raw.underline ? { underline: true } : {}),
    ...(raw.fontColor ? { fontColor: raw.fontColor } : {}),
    ...(raw.indentPx != null ? { indentPx: raw.indentPx } : {}),
    ...(raw.firstIndentPx != null ? { firstIndentPx: raw.firstIndentPx } : {}),
    ...(raw.tight ? { tight: true } : {}),
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

function listLabelFor(model: NumberingModel, numId: string, ilvl: number): string {
  const levels = model.abstract.get(model.num.get(numId) ?? "");
  const lvl = levels?.get(ilvl);
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

function indents(block: string): { indentPx?: number; firstIndentPx?: number } {
  const tag = block.match(/<w:ind\b[^>]*\/?>/)?.[0];
  if (!tag) {
    return {};
  }
  const left = numberIn(tag, "w:left");
  const first = numberIn(tag, "w:firstLine");
  const hanging = numberIn(tag, "w:hanging");
  const out: { indentPx?: number; firstIndentPx?: number } = {};
  if (left != null) {
    out.indentPx = twipsToPx(left);
  }
  if (hanging != null) {
    out.firstIndentPx = -twipsToPx(hanging);
  } else if (first != null) {
    out.firstIndentPx = twipsToPx(first);
  }
  return out;
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
  return Math.round(twips / 15);
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

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
