/**
 * Accept or reject revisions already stored in a .docx (`w:ins` / `w:del` /
 * `w:moveFrom` / `w:moveTo`). Word writes these into the package; the preview
 * only changes those elements.
 *
 * Accept an insertion or move-to: keep the inner runs.
 * Accept a deletion or move-from: drop it.
 * Reject an insertion or move-to: drop it.
 * Reject a deletion or move-from: keep the text as ordinary runs.
 */

import fs from "node:fs/promises";
import JSZip from "jszip";

export type TrackedDecision = "accept" | "reject";

const TRACK_TAGS = ["moveFrom", "moveTo", "ins", "del"] as const;
type TrackTag = (typeof TRACK_TAGS)[number];

const PART_NAME = /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/;

export function rewriteTrackedMarkup(
  xml: string,
  decision: TrackedDecision,
  revId?: string,
): { xml: string; changed: number } {
  const rows = rewriteRowMarks(xml, decision, revId);
  const formats = rewritePropertyChanges(rows.xml, decision, revId);
  const hits = findTrackElements(formats.xml);
  if (hits.length === 0) {
    return { xml: formats.xml, changed: rows.changed + formats.changed };
  }
  let changed = rows.changed + formats.changed;
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    out += formats.xml.slice(cursor, hit.start);
    const applies = !revId || hit.id === revId;
    if (!applies) {
      const inner = rewriteTrackedMarkup(hit.inner, decision, revId);
      changed += inner.changed;
      out +=
        inner.changed === 0
          ? formats.xml.slice(hit.start, hit.end)
          : `${hit.openTag}${inner.xml}</w:${hit.name}>`;
    } else if (keepsInner(hit.name, decision)) {
      const inner = rewriteTrackedMarkup(hit.inner, decision, revId);
      out +=
        hit.name === "del" || hit.name === "moveFrom" ? restoreDeletedText(inner.xml) : inner.xml;
      changed += 1 + inner.changed;
    } else {
      changed += 1;
    }
    cursor = hit.end;
  }
  out += formats.xml.slice(cursor);
  return { xml: out, changed };
}

export async function decideDocxTrackedRevision(params: {
  absPath: string;
  decision: TrackedDecision;
  revId?: string;
}): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.readFile(params.absPath));
  } catch {
    return { ok: false, error: "读不到这份文件。" };
  }
  const names = Object.keys(zip.files).filter((name) => PART_NAME.test(name));
  let changed = 0;
  for (const name of names) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) {
      continue;
    }
    const next = rewriteTrackedMarkup(xml, params.decision, params.revId);
    if (next.changed === 0) {
      continue;
    }
    zip.file(name, next.xml);
    changed += next.changed;
  }
  if (changed === 0) {
    return { ok: false, error: "没找到这处修订。" };
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
  return { ok: true, changed };
}

function rewritePropertyChanges(
  xml: string,
  decision: TrackedDecision,
  revId?: string,
): { xml: string; changed: number } {
  let out = xml;
  let changed = 0;
  for (const name of ["rPrChange", "pPrChange"] as const) {
    const next = rewriteNamedChanges(out, name, decision, revId);
    out = next.xml;
    changed += next.changed;
  }
  return { xml: out, changed };
}

function rewriteNamedChanges(
  xml: string,
  name: "rPrChange" | "pPrChange",
  decision: TrackedDecision,
  revId?: string,
): { xml: string; changed: number } {
  let changed = 0;
  let out = "";
  let cursor = 0;
  let search = 0;
  const wrapper = name === "rPrChange" ? "rPr" : "pPr";
  while (search < xml.length) {
    const start = indexOfWordOpen(xml, name, search);
    if (start < 0) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, start);
    if (openEnd < 0) {
      break;
    }
    const openTag = xml.slice(start, openEnd + 1);
    const id = attrOf(openTag, "w:id");
    const end = xml[openEnd - 1] === "/" ? openEnd + 1 : indexOfMatchingClose(xml, start, name);
    if (!revId || id === revId) {
      const parent = enclosingTag(xml, start, wrapper);
      if (parent) {
        out += xml.slice(cursor, parent.start);
        if (decision === "accept") {
          out += xml.slice(parent.start, start);
          out += xml.slice(end, parent.end);
        } else {
          const inner =
            xml[openEnd - 1] === "/" ? "" : xml.slice(openEnd + 1, end - `</w:${name}>`.length);
          const restored = elementNamedInner(inner, wrapper);
          out += restored ? `<w:${wrapper}>${restored}</w:${wrapper}>` : `<w:${wrapper}/>`;
        }
        changed += 1;
        cursor = parent.end;
        search = parent.end;
        continue;
      }
    }
    search = end;
  }
  out += xml.slice(cursor);
  return { xml: out, changed };
}

function rewriteRowMarks(
  xml: string,
  decision: TrackedDecision,
  revId?: string,
): { xml: string; changed: number } {
  let changed = 0;
  let out = "";
  let cursor = 0;
  let search = 0;
  while (search < xml.length) {
    const start = indexOfWordOpen(xml, "tr", search);
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
    const end = indexOfMatchingClose(xml, start, "tr");
    const inner = xml.slice(openEnd + 1, end - "</w:tr>".length);
    const trPrStart = indexOfWordOpen(inner, "trPr", 0);
    let mark: { kind: "ins" | "del"; id: string; at: number; end: number } | null = null;
    if (trPrStart >= 0) {
      const trPrEnd = indexOfXmlTagEnd(inner, trPrStart);
      const trPrClose =
        inner[trPrEnd - 1] === "/" ? trPrEnd + 1 : indexOfMatchingClose(inner, trPrStart, "trPr");
      const trPr = inner.slice(trPrStart, trPrClose);
      for (const kind of ["ins", "del"] as const) {
        const at = indexOfWordOpen(trPr, kind, 0);
        if (at < 0) {
          continue;
        }
        const tagEnd = indexOfXmlTagEnd(trPr, at);
        const openTag = trPr.slice(at, tagEnd + 1);
        mark = {
          kind,
          id: attrOf(openTag, "w:id"),
          at: start + (openEnd + 1) + trPrStart + at,
          end:
            start +
            (openEnd + 1) +
            trPrStart +
            (trPr[tagEnd - 1] === "/" ? tagEnd + 1 : indexOfMatchingClose(trPr, at, kind)),
        };
        break;
      }
    }
    if (mark && (!revId || mark.id === revId)) {
      out += xml.slice(cursor, start);
      const dropRow =
        (mark.kind === "ins" && decision === "reject") ||
        (mark.kind === "del" && decision === "accept");
      if (!dropRow) {
        out += xml.slice(start, mark.at);
        out += xml.slice(mark.end, end);
      }
      changed += 1;
      cursor = end;
      search = end;
      continue;
    }
    search = end;
  }
  out += xml.slice(cursor);
  return { xml: out, changed };
}

function enclosingTag(
  xml: string,
  innerAt: number,
  name: string,
): { start: number; end: number } | null {
  let start = -1;
  let cursor = 0;
  while (cursor < innerAt) {
    const at = indexOfWordOpen(xml, name, cursor);
    if (at < 0 || at >= innerAt) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, at);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const end = indexOfMatchingClose(xml, at, name);
    if (end > innerAt) {
      start = at;
    }
    cursor = openEnd + 1;
  }
  if (start < 0) {
    return null;
  }
  return { start, end: indexOfMatchingClose(xml, start, name) };
}

function elementNamedInner(xml: string, name: string): string {
  const start = indexOfWordOpen(xml, name, 0);
  if (start < 0) {
    return xml.trim();
  }
  const openEnd = indexOfXmlTagEnd(xml, start);
  if (openEnd < 0 || xml[openEnd - 1] === "/") {
    return "";
  }
  const end = indexOfMatchingClose(xml, start, name);
  return xml.slice(openEnd + 1, end - `</w:${name}>`.length);
}

function keepsInner(name: TrackTag, decision: TrackedDecision): boolean {
  const inserted = name === "ins" || name === "moveTo";
  return decision === "accept" ? inserted : !inserted;
}

function restoreDeletedText(inner: string): string {
  return inner
    .replace(/<w:delText\b/g, "<w:t")
    .replace(/<\/w:delText>/g, "</w:t>")
    .replace(/<w:delInstrText\b/g, "<w:instrText")
    .replace(/<\/w:delInstrText>/g, "</w:instrText>");
}

type TrackHit = {
  start: number;
  end: number;
  name: TrackTag;
  id: string;
  openTag: string;
  inner: string;
};

function findTrackElements(xml: string): TrackHit[] {
  const hits: TrackHit[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    let bestAt = -1;
    let bestName: TrackTag | null = null;
    for (const name of TRACK_TAGS) {
      const at = indexOfWordOpen(xml, name, cursor);
      if (at >= 0 && (bestAt < 0 || at < bestAt)) {
        bestAt = at;
        bestName = name;
      }
    }
    if (bestAt < 0 || !bestName) {
      break;
    }
    const openEnd = indexOfXmlTagEnd(xml, bestAt);
    if (openEnd < 0) {
      break;
    }
    if (xml[openEnd - 1] === "/") {
      cursor = openEnd + 1;
      continue;
    }
    const closeNeedle = `</w:${bestName}>`;
    const end = indexOfMatchingClose(xml, bestAt, bestName);
    const openTag = xml.slice(bestAt, openEnd + 1);
    const innerStart = openEnd + 1;
    const innerEnd = Math.max(innerStart, end - closeNeedle.length);
    hits.push({
      start: bestAt,
      end,
      name: bestName,
      id: attrOf(openTag, "w:id"),
      openTag,
      inner: xml.slice(innerStart, innerEnd),
    });
    cursor = end;
  }
  return hits;
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

function indexOfWordOpen(xml: string, name: string, from: number): number {
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
