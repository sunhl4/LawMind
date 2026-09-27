/**
 * Word 修订署名。空白时用 LawMind；设置里写了名字就用那个名字。
 * 交给 officecli 的是单个参数 `revision.author=…`，所以去掉换行和 `=`。
 */

export const DEFAULT_WORD_REVISION_AUTHOR = "LawMind";

/** 人名够用；再长 Word 修订气泡也难看。 */
export const WORD_REVISION_AUTHOR_MAX_CHARS = 64;

/** 空白、或洗完没有字，返回 undefined（调用方改用默认）。过长截断。 */
export function normalizeWordRevisionAuthor(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  let cleaned = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || ch === "=") {
      continue;
    }
    cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, WORD_REVISION_AUTHOR_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function resolveWordRevisionAuthor(raw: unknown): string {
  return normalizeWordRevisionAuthor(raw) ?? DEFAULT_WORD_REVISION_AUTHOR;
}
