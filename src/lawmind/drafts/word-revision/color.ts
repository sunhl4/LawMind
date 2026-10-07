/** Word's "by author" cycle. The file does not store a color. */
export const WORD_REVISION_COLOR_COUNT = 8;

export function assignAuthorColors(authors: Iterable<string>): Map<string, number> {
  const colors = new Map<string, number>();
  for (const author of authors) {
    const key = author.trim();
    if (!key || colors.has(key)) {
      continue;
    }
    colors.set(key, colors.size % WORD_REVISION_COLOR_COUNT);
  }
  return colors;
}

export function rememberAuthor(colors: Map<string, number>, author: string): number {
  const key = author.trim() || "未知";
  const existing = colors.get(key);
  if (existing != null) {
    return existing;
  }
  const next = colors.size % WORD_REVISION_COLOR_COUNT;
  colors.set(key, next);
  return next;
}
