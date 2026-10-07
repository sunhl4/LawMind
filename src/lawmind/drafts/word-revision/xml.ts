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

/**
 * Replace run content of each `w:p` in document order (including tables)
 * with serialized runs. `pPr` is kept. Paragraph count must match.
 */
export function replaceParagraphRunsInXml(
  xml: string,
  paragraphs: Array<{ pPrInner?: string; runs: WordRevisionRun[] }>,
): { xml: string; replaced: number } {
  let index = 0;
  const next = rewriteParagraphs(xml, (inner) => {
    const row = paragraphs[index];
    index += 1;
    if (!row) {
      return inner;
    }
    const pPr = elementInner(inner, "pPr");
    const pPrXml = row.pPrInner != null ? row.pPrInner : pPr;
    const pPrBlock = pPrXml ? `<w:pPr>${pPrXml}</w:pPr>` : "";
    return `${pPrBlock}${serializeRuns(row.runs)}`;
  });
  return { xml: next, replaced: Math.min(index, paragraphs.length) };
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
  return `<w:r>${rPrXml(run, change)}<w:t xml:space="preserve">${encodeXml(run.text)}</w:t></w:r>`;
}

function serializePlainRun(run: WordRevisionRun, deleted = false): string {
  const textTag = deleted || isDeletedKind(run.track?.kind) ? "delText" : "t";
  return `<w:r>${rPrXml(run)}<w:${textTag} xml:space="preserve">${encodeXml(run.text)}</w:${textTag}></w:r>`;
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
