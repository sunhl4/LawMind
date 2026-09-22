/**
 * Heuristics for "likely incomplete" draft bodies — for analytics or optional gates.
 * Does not change task state by itself; combine with {@link validateDraftAgainstSpec} in callers.
 */

/** Count substrings that often indicate placeholders or TBD (Chinese + ASCII). */
export function countPlaceholderLikeMarkers(text: string): number {
  let n = 0;
  n += (text.match(/__\w+__/g) ?? []).length;
  n += (text.match(/【待[^】]{0,40}】/g) ?? []).length;
  n += (text.match(/\?\?\?/g) ?? []).length;
  n += (text.match(/_{4,}/g) ?? []).length;
  n += (text.match(/<placeholder/gi) ?? []).length;
  n += (text.match(/\bTBD\b/gi) ?? []).length;
  n += (text.match(/\bTODO\b/gi) ?? []).length;
  return n;
}

/**
 * Rough 0..1 score: high when many placeholder-like markers per unit length.
 * Empty or whitespace-only text is treated as maximally "placeholder" (1).
 */
export function heuristicPlaceholderRatio(body: string): number {
  const t = body.trim();
  if (!t) {
    return 1;
  }
  const c = countPlaceholderLikeMarkers(t);
  return Math.min(1, (c * 24) / Math.max(80, t.length));
}
