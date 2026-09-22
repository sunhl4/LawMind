/**
 * 模型自查口径：find 跨度经验值（含句读更严）。
 *
 * 注意执行模型变了（2026-09-20）：**引擎不再按长度拒绝**，而是把每处 find/replace
 * 重算成若干最短改动后落槌（见 minimal-edit-script.ts）。真正的硬不变量是
 * 「一处改动里不得夹着没动的字」，与长度无关。
 *
 * 本文件保留两个用途：
 *  1. 给模型的自查提示（超了通常说明把没动的字也包进了 find，拆开即可）；
 *  2. `explainInvalidSurgicalEdit` 作为「改点不像最短改动」的可读解释，
 *     供跨文书/计划侧边文件做兼容性收窄时引用。
 */

/** Max characters for a find without sentence terminators (自查经验值). */
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
 * 可读解释：这组 find/replace 为什么「不像最短改动」。
 * 返回 undefined 表示按经验值没有疑点。
 *
 * 引擎不再据此拒绝（会重算成最短改动后落槌）；保留给模型自查与兼容性收窄使用。
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
