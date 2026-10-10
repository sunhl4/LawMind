/**
 * Pure find helpers for the Word surface (no React).
 */

export type WordFindHit = {
  paragraphIndex: number;
  start: number;
  end: number;
};

/** Search all-markup text of each paragraph (joined run texts). */
export function findInParagraphTexts(
  paragraphs: string[],
  query: string,
): WordFindHit[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }
  const hits: WordFindHit[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const hay = paragraphs[paragraphIndex] ?? "";
    let from = 0;
    while (from < hay.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      hits.push({ paragraphIndex, start: at, end: at + needle.length });
      from = at + Math.max(1, needle.length);
    }
  }
  return hits;
}

export function stepFindIndex(current: number, total: number, direction: -1 | 1): number {
  if (total <= 0) {
    return -1;
  }
  if (current < 0) {
    return direction > 0 ? 0 : total - 1;
  }
  return (current + direction + total) % total;
}
