/**
 * Hard span-locality gate for apply_surgical_edits.
 * Many edits are allowed; each find must be a short anchored span (not whole sentence/paragraph).
 */

/** Max characters for a find without sentence terminators. */
export const SURGICAL_MAX_FIND_CHARS = 48;

/**
 * Max characters when find contains 。！？； —
 * allows short end-anchors like `实际损失。` / `超过部分。` for clause inserts.
 */
export const SURGICAL_MAX_FIND_WITH_TERMINATOR = 12;

export function commonAffixLength(a: string, b: string): { prefix: number; suffix: number } {
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

function sentenceTerminatorCount(text: string): number {
  return (text.match(/[。！？]/g) ?? []).length;
}

function hasClauseBreak(text: string): boolean {
  return /[；]/.test(text);
}

/**
 * Hard reject reason when find/replace violates span-local minimal edit.
 * Returns undefined when the pair is allowed (phrase swap, short end-anchor insert, etc.).
 */
export function explainSurgicalSpanViolation(find: string, replace: string): string | undefined {
  if (!find || find === replace) {
    return undefined;
  }

  const terminators = sentenceTerminatorCount(find);
  if (terminators >= 2) {
    return (
      "跨度硬门禁：find 含多个句末标点，接近整段。请拆成多组最短字/词锚定；" +
      "段内有问题只改有问题的句子（正例：实际损失。→实际损失，但累计…。）。"
    );
  }
  if (find.length >= 120) {
    return "跨度硬门禁：find 过长（接近整段）。请收窄到最短必要原文；条数不限，可多次/多组提交。";
  }

  const hasTerminator = terminators >= 1 || hasClauseBreak(find);
  if (hasTerminator && find.length > SURGICAL_MAX_FIND_WITH_TERMINATOR) {
    return (
      `跨度硬门禁：含句读的 find 不得超过 ${SURGICAL_MAX_FIND_WITH_TERMINATOR} 字` +
      `（当前 ${find.length}）。能改几个字就只锚定那几个字；` +
      "句末加限制词请用短锚定（正例：实际损失。→实际损失，但累计赔偿总额不超过…。），勿整句删除重写。"
    );
  }

  if (!hasTerminator && find.length > SURGICAL_MAX_FIND_CHARS) {
    return (
      `跨度硬门禁：find 超过 ${SURGICAL_MAX_FIND_CHARS} 字。请拆成更短的字/词/短短语锚定；` +
      "全文可有很多处修改，但每一处都必须最短。"
    );
  }

  // With句读: almost all of find must be preserved (allows句末 insert/expand; blocks delete+rewrite).
  if (terminators >= 1 && find.length > 0) {
    const { prefix, suffix } = commonAffixLength(find, replace);
    const retained = prefix + suffix;
    if (retained / find.length < 0.8) {
      return (
        "跨度硬门禁：含句读的 find 未被充分保留，接近整句删除重写。" +
        "请改为最短锚定并保留 find 原文（句末加词正例：实际损失。→实际损失，但累计…。）。"
      );
    }
  }

  return undefined;
}
