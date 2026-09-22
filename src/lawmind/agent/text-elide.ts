/**
 * 中间省略（head+tail elision）—— 对齐 Codex `truncate_middle_with_token_budget`。
 *
 * 为什么不只砍尾：
 *   - 法律文书两端信息最密：头部是当事人/案号/案由，尾部是诉请、金额、法院、
 *     日期、具状人。只留头部会让模型看不到尾部而「按可见前缀编造」（Claude Code
 *     issue #45770 记录的正是这个失败模式）。
 *   - Codex 对命令输出同样理由保留尾部（「日志与异常的关键在末尾」）。
 *
 * 与单文件分页（analyze_document 的 offset/nextOffset）的分工：
 *   - 单文件可以续读 → 头部截断 + 精确续读配方（Claude Code PARTIAL view）。
 *   - 批量读取一个文件只有一次机会 → 头尾都留，并把「省略了多少」写进正文标记，
 *     让模型知道自己拿到的是两端，而不是完整文档。
 */

/**
 * 头部占比。法律文书头部信息密度更高（当事人/案号/案由），故略重于尾部，
 * 而非 Codex 命令输出的均分。改这一个数即可调权重。
 */
export const ELIDE_HEAD_RATIO = 0.6;

/** 小于该长度的内容不值得省略（标记本身也要成本）。 */
export const ELIDE_MIN_BUDGET = 200;

export type ElideResult = {
  text: string;
  elided: boolean;
  /** 被省略的字符数（0 表示未省略）。 */
  elidedChars: number;
};

/** 供模型阅读的省略标记：给出被删除的量，便于判断"这不是全文"。 */
export function formatElisionMarker(elidedChars: number): string {
  return `\n\n…[中间省略 ${elidedChars} 字符；这是文件的两端，不是全文]…\n\n`;
}

function safeBoundary(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(text.length, index));
  // 避免把代理对（emoji 等）从中间切开。
  const code = text.charCodeAt(clamped);
  if (Number.isNaN(code)) {
    return clamped;
  }
  const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
  return isLowSurrogate ? clamped - 1 : clamped;
}

/**
 * 把 `text` 压到约 `budgetChars` 字符：保留头部与尾部，中间用标记替代。
 * 长度已在预算内则原样返回（`elided: false`）。
 */
export function elideMiddle(text: string, budgetChars: number): ElideResult {
  if (text.length <= budgetChars) {
    return { text, elided: false, elidedChars: 0 };
  }
  if (budgetChars < ELIDE_MIN_BUDGET) {
    return {
      text: text.slice(0, Math.max(0, budgetChars)),
      elided: true,
      elidedChars: Math.max(0, text.length - budgetChars),
    };
  }
  const headBudget = Math.floor(budgetChars * ELIDE_HEAD_RATIO);
  const tailBudget = budgetChars - headBudget;
  const headEnd = safeBoundary(text, headBudget);
  const tailStart = safeBoundary(text, text.length - tailBudget);
  if (tailStart <= headEnd) {
    return {
      text: text.slice(0, Math.max(0, budgetChars)),
      elided: true,
      elidedChars: Math.max(0, text.length - budgetChars),
    };
  }
  const removed = tailStart - headEnd;
  return {
    text: `${text.slice(0, headEnd)}${formatElisionMarker(removed)}${text.slice(tailStart)}`,
    elided: true,
    elidedChars: removed,
  };
}
