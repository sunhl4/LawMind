import type { WordRevisionComment } from "./types.js";
import { encodeXml, indexOfMatchingClose, indexOfWordOpen, indexOfXmlTagEnd } from "./xml.js";

export function parseCommentsXml(xml: string): WordRevisionComment[] {
  const out: WordRevisionComment[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = indexOfWordOpen(xml, "comment", cursor);
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
    const end = indexOfMatchingClose(xml, start, "comment");
    const openTag = xml.slice(start, openEnd + 1);
    const inner = xml.slice(openEnd + 1, end - "</w:comment>".length);
    const id = attrOf(openTag, "w:id") || String(out.length);
    const author = attrOf(openTag, "w:author").trim() || "未知";
    const date = attrOf(openTag, "w:date");
    const body = visibleText(inner).trim() || "批注";
    out.push({
      commentId: id,
      author,
      body,
      anchorText: "",
      ...(date ? { date } : {}),
    });
    cursor = end;
  }
  return out;
}

export function serializeCommentsXml(comments: WordRevisionComment[]): string {
  const body = comments
    .map((comment) => {
      const date = comment.date ? ` w:date="${encodeXml(comment.date)}"` : "";
      return (
        `<w:comment w:id="${encodeXml(comment.commentId)}" w:author="${encodeXml(comment.author)}"${date}>` +
        `<w:p><w:r><w:t xml:space="preserve">${encodeXml(comment.body)}</w:t></w:r></w:p>` +
        `</w:comment>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:comments>`
  );
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

function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1] ?? "").join("");
}
