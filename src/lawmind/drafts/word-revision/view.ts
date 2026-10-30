import { assignAuthorColors, rememberAuthor } from "./color.js";
import { coalesceRuns, flattenRuns, isDeletion, isInsertion } from "./compose.js";
import type {
  WordMarkupMode,
  WordRevisionBalloon,
  WordRevisionRun,
  WordTrackKind,
} from "./types.js";

export function collectAuthors(runs: WordRevisionRun[]): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const run of runs) {
    const author = run.track?.author.trim();
    if (!author || set.has(author)) {
      continue;
    }
    set.add(author);
    seen.push(author);
  }
  return seen;
}

export function colorsForRuns(runs: WordRevisionRun[]): Map<string, number> {
  return assignAuthorColors(collectAuthors(runs));
}

export function projectRuns(
  runs: WordRevisionRun[],
  mode: WordMarkupMode,
  hiddenAuthors?: Set<string>,
): WordRevisionRun[] {
  const atoms = flattenRuns(runs).flatMap((atom) => {
    const author = atom.track?.author.trim();
    const hidden = Boolean(author && hiddenAuthors?.has(author));
    if (hidden) {
      if (isDeletion(atom.track)) {
        return [];
      }
      const { track: _track, ...plain } = atom;
      return [plain];
    }
    if (mode === "all") {
      return [atom];
    }
    if (mode === "original") {
      if (isInsertion(atom.track)) {
        return [];
      }
      const { track: _track, ...plain } = atom;
      return [plain];
    }
    if (isDeletion(atom.track)) {
      return [];
    }
    const { track: _track, ...plain } = atom;
    return [plain];
  });
  return coalesceRuns(atoms);
}

export function paragraphHasMarkup(runs: WordRevisionRun[], hiddenAuthors?: Set<string>): boolean {
  return runs.some((run) => {
    const author = run.track?.author.trim();
    if (!run.track || (author && hiddenAuthors?.has(author))) {
      return false;
    }
    return true;
  });
}

export function collectBalloons(
  runs: WordRevisionRun[],
  colors: Map<string, number>,
): WordRevisionBalloon[] {
  const out: WordRevisionBalloon[] = [];
  let open: WordRevisionBalloon | null = null;
  const flush = () => {
    if (!open) {
      return;
    }
    out.push(open);
    open = null;
  };
  for (const run of runs) {
    const track = run.track;
    if (track?.kind === "format") {
      if (open && open.author === track.author) {
        const ids = open.revIds ?? [open.revId];
        if (!ids.includes(track.id)) {
          ids.push(track.id);
        }
        open.revIds = ids;
        continue;
      }
      flush();
      pushBalloon(out, run, colors);
      continue;
    }
    if (!track || !isTextMarkup(track.kind)) {
      // Unchanged original text splits revisions.
      if (run.text && !run.preservedXml) {
        flush();
      }
      continue;
    }
    if (open && open.author === track.author) {
      const ids = open.revIds ?? [open.revId];
      if (!ids.includes(track.id)) {
        ids.push(track.id);
      }
      open.revIds = ids;
      const parts = open.parts ?? [{ change: open.change, text: open.text }];
      const last = parts[parts.length - 1];
      if (last && last.change === track.kind) {
        last.text += run.text;
      } else {
        parts.push({ change: track.kind, text: run.text });
      }
      open.parts = parts;
      open.text = parts.map((part) => part.text).join("");
      if (track.hunkId) {
        const hunks = open.hunkIds ?? (open.hunkId ? [open.hunkId] : []);
        if (!hunks.includes(track.hunkId)) {
          hunks.push(track.hunkId);
        }
        open.hunkIds = hunks;
        if (!open.hunkId) {
          open.hunkId = track.hunkId;
        }
      }
      continue;
    }
    flush();
    open = balloonFromRun(run, colors);
  }
  flush();
  return out;
}

function isTextMarkup(kind: WordTrackKind): boolean {
  return kind === "ins" || kind === "del" || kind === "moveFrom" || kind === "moveTo";
}

/** Balloon id for each run. Contiguous markup by one author shares the first id. */
export function contiguousGroupKeys(runs: WordRevisionRun[]): string[] {
  const keys: string[] = [];
  let author = "";
  let key = "";
  for (const run of runs) {
    const track = run.track;
    if (!track || !isTextMarkup(track.kind)) {
      if (track?.kind === "format" && key && track.author === author) {
        keys.push(key);
        continue;
      }
      if (track?.kind === "format" || (run.text && !run.preservedXml && !track)) {
        author = "";
        key = "";
      }
      keys.push("");
      continue;
    }
    if (!key || track.author !== author) {
      key = track.id;
      author = track.author;
    }
    keys.push(key);
  }
  return keys;
}

function balloonFromRun(
  run: WordRevisionRun,
  colors: Map<string, number>,
): WordRevisionBalloon | null {
  const track = run.track;
  if (!track) {
    return null;
  }
  return {
    revId: track.id,
    revIds: [track.id],
    change: track.kind,
    parts: [{ change: track.kind, text: run.text }],
    author: track.author,
    text: run.text,
    color: rememberAuthor(colors, track.author),
    ...(track.date ? { date: track.date } : {}),
    ...(track.format ? { format: track.format } : {}),
    ...(track.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
    ...(track.hunkId ? { hunkId: track.hunkId, hunkIds: [track.hunkId] } : {}),
  };
}

function pushBalloon(
  out: WordRevisionBalloon[],
  run: WordRevisionRun,
  colors: Map<string, number>,
): void {
  const track = run.track;
  if (!track) {
    return;
  }
  out.push({
    revId: track.id,
    change: track.kind,
    author: track.author,
    text: run.text,
    color: rememberAuthor(colors, track.author),
    ...(track.date ? { date: track.date } : {}),
    ...(track.format ? { format: track.format } : {}),
    ...(track.disposition === "accepted" ? { disposition: "accepted" as const } : {}),
    ...(track.hunkId ? { hunkId: track.hunkId } : {}),
  });
}
