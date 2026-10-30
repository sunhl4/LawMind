/**
 * LawMind fold state for tracks that stay in the file as Word revisions.
 * The part is not a w: attribute, so Word still shows w:ins / w:del.
 */

import type { WordRevisionRun } from "./types.js";

export const DISPOSITION_PART = "word/lawmind-disposition.xml";

export function parseDispositionXml(xml: string): string[] {
  return parseDispositionPart(xml).acceptedIds;
}

export type DispositionPart = {
  acceptedIds: string[];
  /** Track id → redline hunk id, for tracks LawMind materialized. */
  trackHunks: Record<string, string>;
};

export function parseDispositionPart(xml: string): DispositionPart {
  const acceptedIds: string[] = [];
  const pattern = /<id>([^<]*)<\/id>/g;
  for (const match of xml.matchAll(pattern)) {
    const id = decodeXml(match[1] ?? "").trim();
    if (id && !acceptedIds.includes(id)) {
      acceptedIds.push(id);
    }
  }
  const trackHunks: Record<string, string> = {};
  const tracks = /<track\b[^>]*\bid="([^"]*)"[^>]*\bhunk="([^"]*)"[^>]*\/?>/g;
  for (const match of xml.matchAll(tracks)) {
    const id = decodeXml(match[1] ?? "").trim();
    const hunkId = decodeXml(match[2] ?? "").trim();
    if (id && hunkId) {
      trackHunks[id] = hunkId;
    }
  }
  return { acceptedIds, trackHunks };
}

export function serializeDispositionXml(
  ids: readonly string[],
  trackHunks?: Readonly<Record<string, string>>,
): string {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const body = unique.map((id) => `<id>${encodeXml(id)}</id>`).join("");
  const tracks = Object.entries(trackHunks ?? {})
    .map(([id, hunkId]) => [id.trim(), hunkId.trim()] as const)
    .filter(([id, hunkId]) => id && hunkId)
    .map(([id, hunkId]) => `<track id="${encodeXml(id)}" hunk="${encodeXml(hunkId)}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<lawmindDisposition xmlns="urn:lawmind:revision-disposition">${body}${tracks}</lawmindDisposition>`
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

/**
 * Track id → hunk id written in this save, plus mappings that live outside the
 * saved runs (e.g. a story the caller did not include). Ids that were in the
 * previous document but are gone now are dropped, so a removed revision cannot
 * keep pointing at an old hunk.
 */
export function nextTrackHunks(params: {
  previous: Readonly<Record<string, string>>;
  previousStoryIds: ReadonlySet<string>;
  paragraphs: readonly WordRevisionRun[][];
}): Record<string, string> {
  const present = new Set<string>();
  for (const runs of params.paragraphs) {
    for (const run of runs) {
      if (run.track?.id) {
        present.add(run.track.id);
      }
    }
  }
  const next: Record<string, string> = {};
  for (const [id, hunkId] of Object.entries(params.previous)) {
    if (!params.previousStoryIds.has(id) && !present.has(id) && id && hunkId) {
      next[id] = hunkId;
    }
  }
  for (const runs of params.paragraphs) {
    for (const run of runs) {
      const id = run.track?.id;
      const hunkId = run.track?.hunkId;
      if (id && hunkId) {
        next[id] = hunkId;
      }
    }
  }
  return next;
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
