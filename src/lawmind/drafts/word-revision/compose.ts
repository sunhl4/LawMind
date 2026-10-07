/**
 * Word Track Changes composition. New marks always belong to the current
 * author, even when the caret sits inside someone else's revision.
 */

import type {
  ComposeAuthor,
  WordRevisionAtom,
  WordRevisionRun,
  WordRevisionTrack,
  WordRunMark,
} from "./types.js";

export function makeAuthorClock(
  name: string,
  startId = 1,
  now = "2026-10-07T00:00:00.000Z",
): ComposeAuthor {
  let n = startId;
  return {
    name,
    now,
    nextId: () => {
      const id = String(n);
      n += 1;
      return id;
    },
  };
}

export function maxTrackId(runs: WordRevisionRun[]): number {
  let max = 0;
  for (const run of runs) {
    const id = Number(run.track?.id);
    if (Number.isFinite(id) && id > max) {
      max = id;
    }
  }
  return max;
}

export function flattenRuns(runs: WordRevisionRun[]): WordRevisionAtom[] {
  const atoms: WordRevisionAtom[] = [];
  for (const run of runs) {
    for (const ch of run.text) {
      atoms.push({
        ch,
        ...(run.track ? { track: run.track } : {}),
        ...(run.mark ? { mark: run.mark } : {}),
        ...(run.commentIds && run.commentIds.length > 0 ? { commentIds: run.commentIds } : {}),
      });
    }
  }
  return atoms;
}

export function coalesceRuns(atoms: WordRevisionAtom[]): WordRevisionRun[] {
  const runs: WordRevisionRun[] = [];
  for (const atom of atoms) {
    const last = runs[runs.length - 1];
    if (
      last &&
      sameTrack(last.track, atom.track) &&
      sameMark(last.mark, atom.mark) &&
      sameIds(last.commentIds, atom.commentIds)
    ) {
      last.text += atom.ch;
      continue;
    }
    runs.push({
      text: atom.ch,
      ...(atom.track ? { track: atom.track } : {}),
      ...(atom.mark ? { mark: atom.mark } : {}),
      ...(atom.commentIds && atom.commentIds.length > 0 ? { commentIds: atom.commentIds } : {}),
    });
  }
  return runs.filter((run) => run.text.length > 0);
}

export function allMarkupText(runs: WordRevisionRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function finalText(runs: WordRevisionRun[]): string {
  return runs
    .filter((run) => !isDeletion(run.track))
    .map((run) => run.text)
    .join("");
}

export function originalText(runs: WordRevisionRun[]): string {
  return runs
    .filter((run) => !isInsertion(run.track))
    .map((run) => run.text)
    .join("");
}

export function isInsertion(track: WordRevisionTrack | undefined): boolean {
  return track?.kind === "ins" || track?.kind === "moveTo";
}

export function isDeletion(track: WordRevisionTrack | undefined): boolean {
  return track?.kind === "del" || track?.kind === "moveFrom";
}

export function sameTrack(
  a: WordRevisionTrack | undefined,
  b: WordRevisionTrack | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.author === b.author &&
    a.date === b.date &&
    a.moveName === b.moveName &&
    a.format === b.format &&
    a.disposition === b.disposition
  );
}

export function insertText(
  runs: WordRevisionRun[],
  at: number,
  text: string,
  author: ComposeAuthor,
): WordRevisionRun[] {
  if (!text) {
    return runs;
  }
  const atoms = flattenRuns(runs);
  const index = clamp(at, 0, atoms.length);
  const track = trackForInsert(atoms, index, author);
  const mark = atoms[index - 1]?.mark ?? atoms[index]?.mark;
  const commentIds = atoms[index - 1]?.commentIds ?? atoms[index]?.commentIds;
  const inserted: WordRevisionAtom[] = Array.from(text, (ch) => ({
    ch,
    track,
    ...(mark ? { mark } : {}),
    ...(commentIds && commentIds.length > 0 ? { commentIds } : {}),
  }));
  return coalesceRuns([...atoms.slice(0, index), ...inserted, ...atoms.slice(index)]);
}

export function deleteBackward(
  runs: WordRevisionRun[],
  caret: number,
  count: number,
  author: ComposeAuthor,
): { runs: WordRevisionRun[]; caret: number } {
  const atoms = flattenRuns(runs);
  let at = clamp(caret, 0, atoms.length);
  let left = Math.max(0, count);
  while (left > 0 && at > 0) {
    const i = at - 1;
    const atom = atoms[i];
    if (!atom) {
      break;
    }
    if (atom.track && (isInsertion(atom.track) || isDeletion(atom.track))) {
      atoms.splice(i, 1);
      at = i;
    } else {
      atom.track = deletionTrack(atoms, i, author);
      at = i;
    }
    left -= 1;
  }
  return { runs: coalesceRuns(atoms), caret: at };
}

export function deleteForward(
  runs: WordRevisionRun[],
  caret: number,
  count: number,
  author: ComposeAuthor,
): { runs: WordRevisionRun[]; caret: number } {
  const atoms = flattenRuns(runs);
  let at = clamp(caret, 0, atoms.length);
  let left = Math.max(0, count);
  while (left > 0 && at < atoms.length) {
    const atom = atoms[at];
    if (!atom) {
      break;
    }
    if (atom.track && (isInsertion(atom.track) || isDeletion(atom.track))) {
      atoms.splice(at, 1);
    } else {
      atom.track = deletionTrack(atoms, at, author);
      at += 1;
    }
    left -= 1;
  }
  return { runs: coalesceRuns(atoms), caret: at };
}

/**
 * Replace [start, end) in the all-markup stream. Original characters become
 * a deletion by the current author; existing insertions in the range are
 * removed. New text is inserted after those deletions.
 */
export function replaceRange(
  runs: WordRevisionRun[],
  start: number,
  end: number,
  text: string,
  author: ComposeAuthor,
): WordRevisionRun[] {
  const atoms = flattenRuns(runs);
  const from = clamp(Math.min(start, end), 0, atoms.length);
  const to = clamp(Math.max(start, end), from, atoms.length);
  const ourDel: WordRevisionTrack = {
    kind: "del",
    id: author.nextId(),
    author: author.name,
    date: author.now,
  };
  let kept = 0;
  for (let i = to - 1; i >= from; i -= 1) {
    const atom = atoms[i];
    if (!atom) {
      continue;
    }
    if (atom.track && (isInsertion(atom.track) || isDeletion(atom.track))) {
      atoms.splice(i, 1);
      continue;
    }
    atom.track = ourDel;
    kept += 1;
  }
  return insertText(coalesceRuns(atoms), from + kept, text, author);
}

export function decideRuns(
  runs: WordRevisionRun[],
  revId: string,
  decision: "accept" | "reject",
): WordRevisionRun[] {
  const next: WordRevisionAtom[] = [];
  for (const atom of flattenRuns(runs)) {
    if (atom.track?.id !== revId) {
      next.push(atom);
      continue;
    }
    if (atom.track.kind === "format") {
      if (decision === "accept") {
        const { track: _track, ...plain } = atom;
        next.push(plain);
      } else {
        const { track: _track, mark: _mark, ...plain } = atom;
        next.push(plain);
      }
      continue;
    }
    const inserted = isInsertion(atom.track);
    const deleted = isDeletion(atom.track);
    const keep = decision === "accept" ? inserted : deleted;
    if (keep) {
      const { track: _track, ...plain } = atom;
      next.push(plain);
    }
  }
  return coalesceRuns(next);
}

export function moveRange(
  runs: WordRevisionRun[],
  start: number,
  end: number,
  insertAt: number,
  author: ComposeAuthor,
): WordRevisionRun[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (to <= from) {
    return runs;
  }
  const atoms = flattenRuns(runs);
  const slice = atoms.slice(from, to);
  if (slice.length === 0) {
    return runs;
  }
  const name = `move-${author.nextId()}`;
  const fromTrack: WordRevisionTrack = {
    kind: "moveFrom",
    id: author.nextId(),
    author: author.name,
    date: author.now,
    moveName: name,
  };
  const toTrack: WordRevisionTrack = {
    kind: "moveTo",
    id: author.nextId(),
    author: author.name,
    date: author.now,
    moveName: name,
  };
  const moved = slice.map((atom) => ({ ...atom, track: fromTrack }));
  const copy = slice.map((atom) => ({
    ch: atom.ch,
    track: toTrack,
    ...(atom.mark ? { mark: atom.mark } : {}),
  }));
  const without = [...atoms.slice(0, from), ...moved, ...atoms.slice(to)];
  let dest = insertAt;
  if (insertAt > to) {
    dest = insertAt;
  } else if (insertAt > from) {
    dest = to;
  }
  return coalesceRuns([...without.slice(0, dest), ...copy, ...without.slice(dest)]);
}

export function finalOffsetToAll(runs: WordRevisionRun[], finalOffset: number): number {
  let seen = 0;
  let all = 0;
  for (const atom of flattenRuns(runs)) {
    if (seen >= finalOffset) {
      return all;
    }
    if (!isDeletion(atom.track)) {
      seen += 1;
    }
    all += 1;
  }
  return all;
}

export function originalOffsetToAll(runs: WordRevisionRun[], originalOffset: number): number {
  let seen = 0;
  let all = 0;
  for (const atom of flattenRuns(runs)) {
    if (seen >= originalOffset) {
      return all;
    }
    if (!isInsertion(atom.track)) {
      seen += 1;
    }
    all += 1;
  }
  return all;
}

export function applyFormatRange(
  runs: WordRevisionRun[],
  start: number,
  end: number,
  format: "加粗" | "倾斜" | "下划线",
  author: ComposeAuthor,
): WordRevisionRun[] {
  const atoms = flattenRuns(runs);
  const from = clamp(Math.min(start, end), 0, atoms.length);
  const to = clamp(Math.max(start, end), from, atoms.length);
  const track: WordRevisionTrack = {
    kind: "format",
    id: author.nextId(),
    author: author.name,
    date: author.now,
    format,
  };
  for (let i = from; i < to; i += 1) {
    const atom = atoms[i];
    if (!atom || isDeletion(atom.track)) {
      continue;
    }
    atom.mark = {
      ...atom.mark,
      ...(format === "加粗" ? { bold: true } : {}),
      ...(format === "倾斜" ? { italic: true } : {}),
      ...(format === "下划线" ? { underline: true } : {}),
    };
    if (!atom.track) {
      atom.track = track;
    }
  }
  return coalesceRuns(atoms);
}

export function attachComment(
  runs: WordRevisionRun[],
  start: number,
  end: number,
  commentId: string,
): WordRevisionRun[] {
  const atoms = flattenRuns(runs);
  const from = clamp(Math.min(start, end), 0, atoms.length);
  const to = clamp(Math.max(start, end), from, atoms.length);
  for (let i = from; i < to; i += 1) {
    const atom = atoms[i];
    if (!atom) {
      continue;
    }
    const ids = atom.commentIds ?? [];
    if (!ids.includes(commentId)) {
      atom.commentIds = [...ids, commentId];
    }
  }
  return coalesceRuns(atoms);
}

export function inspectRuns(
  runs: WordRevisionRun[],
): Array<[string, WordRevisionTrack["kind"] | undefined, string | undefined]> {
  return runs.map((run) => [run.text, run.track?.kind, run.track?.author]);
}

function trackForInsert(
  atoms: WordRevisionAtom[],
  at: number,
  author: ComposeAuthor,
): WordRevisionTrack {
  const left = at > 0 ? atoms[at - 1] : undefined;
  const right = at < atoms.length ? atoms[at] : undefined;
  if (
    left?.track &&
    right?.track &&
    sameTrack(left.track, right.track) &&
    isInsertion(left.track)
  ) {
    if (left.track.author === author.name) {
      return left.track;
    }
    return newInsertion(author);
  }
  if (left?.track && isInsertion(left.track) && left.track.author === author.name) {
    return left.track;
  }
  if (right?.track && isInsertion(right.track) && right.track.author === author.name) {
    return right.track;
  }
  return newInsertion(author);
}

function deletionTrack(
  atoms: WordRevisionAtom[],
  index: number,
  author: ComposeAuthor,
): WordRevisionTrack {
  const prev = index > 0 ? atoms[index - 1] : undefined;
  if (prev?.track && isDeletion(prev.track) && prev.track.author === author.name) {
    return prev.track;
  }
  const next = atoms[index + 1];
  if (next?.track && isDeletion(next.track) && next.track.author === author.name) {
    return next.track;
  }
  return {
    kind: "del",
    id: author.nextId(),
    author: author.name,
    date: author.now,
  };
}

function newInsertion(author: ComposeAuthor): WordRevisionTrack {
  return {
    kind: "ins",
    id: author.nextId(),
    author: author.name,
    date: author.now,
  };
}

function sameMark(a: WordRunMark | undefined, b: WordRunMark | undefined): boolean {
  return (
    a?.bold === b?.bold &&
    a?.italic === b?.italic &&
    a?.underline === b?.underline &&
    a?.fontSizePx === b?.fontSizePx &&
    a?.fontColor === b?.fontColor &&
    a?.fontFamily === b?.fontFamily
  );
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length && !b?.length) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((id, index) => id === b[index]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type { WordRunMark };
