/**
 * LawMind fold state for tracks that stay in the file as Word revisions.
 * The part is not a w: attribute, so Word still shows w:ins / w:del.
 */

import type { WordRevisionRun } from "./types.js";

export const DISPOSITION_PART = "word/lawmind-disposition.xml";

export function parseDispositionXml(xml: string): string[] {
  const ids: string[] = [];
  const pattern = /<id>([^<]*)<\/id>/g;
  for (const match of xml.matchAll(pattern)) {
    const id = decodeXml(match[1] ?? "").trim();
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export function serializeDispositionXml(ids: readonly string[]): string {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const body = unique.map((id) => `<id>${encodeXml(id)}</id>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<lawmindDisposition xmlns="urn:lawmind:revision-disposition">${body}</lawmindDisposition>`
  );
}

export function acceptedIdsInRuns(paragraphs: readonly WordRevisionRun[][]): string[] {
  const ids: string[] = [];
  for (const runs of paragraphs) {
    for (const run of runs) {
      const id = run.track?.disposition === "accepted" ? run.track.id : "";
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Ids accepted in this save, plus accepted ids that live outside the saved story. */
export function nextDispositionIds(params: {
  previousAccepted: readonly string[];
  previousStoryIds: ReadonlySet<string>;
  paragraphs: readonly WordRevisionRun[][];
}): string[] {
  const present = new Set<string>();
  for (const runs of params.paragraphs) {
    for (const run of runs) {
      if (run.track?.id) {
        present.add(run.track.id);
      }
    }
  }
  const kept = params.previousAccepted.filter(
    (id) => !params.previousStoryIds.has(id) && !present.has(id),
  );
  for (const id of acceptedIdsInRuns(params.paragraphs)) {
    if (!kept.includes(id)) {
      kept.push(id);
    }
  }
  return kept;
}

export function withAcceptedDisposition(
  runs: WordRevisionRun[],
  ids: ReadonlySet<string>,
): WordRevisionRun[] {
  if (ids.size === 0) {
    return runs;
  }
  return runs.map((run) => {
    if (!run.track || !ids.has(run.track.id) || run.track.disposition === "accepted") {
      return run;
    }
    return { ...run, track: { ...run.track, disposition: "accepted" } };
  });
}

export function trackIdsInDocumentXml(xml: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange)\b[^>]*\bw:id="([^"]+)"/g;
  for (const match of xml.matchAll(pattern)) {
    const id = decodeXml(match[1] ?? "").trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function encodeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
