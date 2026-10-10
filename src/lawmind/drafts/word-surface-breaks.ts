/**
 * Word inline breaks are elements (`w:br`, `w:tab`, `w:cr`), not glyphs.
 * Control characters such as U+000B paint as boxes in 宋体, so the surface
 * keeps them as `\n` / `\t` / `\f` and writes them back as elements.
 */

/** In-paragraph line break (`w:br`, `w:cr`, U+000B). */
export const WORD_LINE_BREAK = "\n";
/** Page break (`w:br w:type="page"`). */
export const WORD_PAGE_BREAK = "\f";
/** Tab (`w:tab`). */
export const WORD_TAB = "\t";

const WINGDINGS: Record<number, string> = {
  0x6c: "•",
  0x6e: "■",
  0x6f: "□",
  0x71: "○",
  0x73: "◆",
  0xa1: "○",
  0xa2: "●",
  0xa3: "■",
  0xa4: "□",
  0xa7: "▪",
  0xa8: "►",
  0xb2: "☑",
  0xb7: "•",
  0xd8: "→",
  0xfc: "✓",
  0xfe: "✓",
  0x78: "✗",
  0xfb: "✗",
};

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePointToChar(hex, 16))
    .replace(/&#(\d+);/g, (_, dec: string) => codePointToChar(dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Map Word control characters onto break/tab/page sentinels that have no glyph. */
export function normalizeWordControls(text: string): string {
  let out = text
    .replaceAll("\u000B", WORD_LINE_BREAK)
    .replace(/\u2028|\u2029/g, WORD_LINE_BREAK)
    .replace(/\r\n/g, WORD_LINE_BREAK)
    .replaceAll("\r", WORD_LINE_BREAK)
    .replaceAll("\u0007", "")
    .replaceAll("\uFEFF", "")
    .replaceAll("\u001E", "\u2011")
    .replaceAll("\u001F", "\u00AD");
  // Drop remaining C0 controls (intentional; avoid control-char regex lint).
  let cleaned = "";
  for (const ch of out) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x08 || (code >= 0x0e && code <= 0x1d)) {
      continue;
    }
    cleaned += ch;
  }
  return cleaned;
}

/** `w:sym` → a Unicode stand-in. Unknown private-use chars are dropped (they paint as boxes). */
export function wordSymbolText(font: string, hex: string): string {
  const code = Number.parseInt(hex, 16);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  const mapped = mapSymbol(font, code);
  if (mapped) {
    return mapped;
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return "";
  }
  if (code >= 0xf000 && code <= 0xf0ff) {
    return "";
  }
  if (code < 0x20 || code === 0x7f) {
    return "";
  }
  return String.fromCodePoint(code);
}

export function serializeWordRunText(text: string, textTag: "t" | "delText"): string {
  const normalized = normalizeWordControls(text);
  if (!/[\n\t\f]/u.test(normalized)) {
    return `<w:${textTag} xml:space="preserve">${encodeXml(normalized)}</w:${textTag}>`;
  }
  let out = "";
  for (const part of normalized.split(/(\n|\t|\f)/u)) {
    if (!part) {
      continue;
    }
    if (part === WORD_LINE_BREAK) {
      out += "<w:br/>";
      continue;
    }
    if (part === WORD_TAB) {
      out += "<w:tab/>";
      continue;
    }
    if (part === WORD_PAGE_BREAK) {
      out += '<w:br w:type="page"/>';
      continue;
    }
    out += `<w:${textTag} xml:space="preserve">${encodeXml(part)}</w:${textTag}>`;
  }
  return out;
}

function mapSymbol(font: string, code: number): string | undefined {
  const key = font.replace(/\s+/g, "").toLowerCase();
  const byte = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  if (key === "wingdings" || key === "wingdings2" || key === "wingdings3" || key === "") {
    return WINGDINGS[byte];
  }
  if (key === "symbol" && byte === 0xb7) {
    return "•";
  }
  return WINGDINGS[byte];
}

function codePointToChar(raw: string, radix: number): string {
  const code = Number.parseInt(raw, radix);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return "";
  }
  return String.fromCodePoint(code);
}

function encodeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
