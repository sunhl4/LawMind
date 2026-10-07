import { assignAuthorColors, rememberAuthor } from "./color.js";
import { coalesceRuns, flattenRuns, isDeletion, isInsertion } from "./compose.js";
import type { WordMarkupMode, WordRevisionBalloon, WordRevisionRun } from "./types.js";

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
  for (const run of runs) {
    const track = run.track;
    if (!track || (track.kind === "format" && !run.text)) {
      if (track?.kind === "format") {
        pushBalloon(out, run, colors);
      }
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.author === track.author && last.change === track.kind) {
      last.text += run.text;
      continue;
    }
    pushBalloon(out, run, colors);
  }
  return out;
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
  });
}
