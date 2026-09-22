/**
 * 条款类型关键词——**立场所用条款类型的唯一真相源**。
 *
 * 2026-09-20（P0-4d）合并。此前同一张表在三处各抄了一份：
 *   - `historical-scan/habit-extract.ts`（原始）
 *   - `stance/capture.ts`（注释写着 "Duplicated from historical-scan/habit-extract — do not import (cycle risk)"）
 *   - `stance/self-check.ts`（改名为 `CLAUSE_IN_TEXT`）
 * 而三份**并不一致**：self-check 的「管辖」额外含 `人民法院`，另两份没有。
 * 于是「同一段文字属于哪类条款」取决于调用的是哪个模块——这是典型的复制漂移，
 * 不报错、只会让立场统计与自检结果对不上。
 *
 * 本模块**零 import**，因此不构成循环，`stance/` 与 `historical-scan/` 都可以安全引用
 * （`clause/` 只依赖 `./ast` `./pattern` `./dsl` 与 `../lint/chinese-numeral`，不回指它们）。
 *
 * 与 `clause/dsl.ts` 的 `ClauseType`（definition / obligation / right / liability / dispute）
 * 是**两套不同词汇**：那一套服务于条款 AST 解析，本表服务于立场与习惯聚类。
 * 合并两者会改变两边的语义，故不合并——但两边都不应再各自复制本表。
 */

/** 一条条款类型判据。`id` 同时作为立场库的 `clauseType` 与习惯聚类的键。 */
export type ClauseTypeKeyword = {
  id: string;
  re: RegExp;
};

/**
 * 判据**有序**：调用方通常取首个命中，所以顺序即优先级。
 * 新增类型请追加在末尾，并同步 `clause-type-keywords.test.ts` 的锁定用例。
 */
export const CLAUSE_TYPE_KEYWORDS: ReadonlyArray<ClauseTypeKeyword> = [
  { id: "管辖", re: /管辖|争议解决|仲裁/ },
  { id: "违约金", re: /违约金/ },
  { id: "保密", re: /保密/ },
  { id: "赔偿", re: /赔偿|责任限制|责任上限/ },
  { id: "知识产权", re: /知识产权|许可使用/ },
  { id: "定金", re: /定金/ },
];

/**
 * 文本 → 条款类型（首个命中），命中不了返回 undefined（不猜）。
 */
export function detectClauseTypeKeyword(text: string): string | undefined {
  for (const row of CLAUSE_TYPE_KEYWORDS) {
    if (row.re.test(text)) {
      return row.id;
    }
  }
  return undefined;
}

/**
 * 「审判/仲裁机构」提及。**刻意不并入 `CLAUSE_TYPE_KEYWORDS` 的「管辖」判据**：
 *
 * - `habit-extract` / `stance/capture` 用 blob 的**首个**命中做分类，
 *   把「人民法院」并进「管辖」会让「赔偿责任……由人民法院判决」这类 hunk
 *   被误分类成管辖，从而污染立场聚类与习惯候选。
 * - `stance/self-check` 只问「正文是否谈到该类条款」，放宽判据只会多一条 info 级提示，
 *   不会造成误分类，因此**在这里额外放宽是有意的**。
 *
 * 这个差异以前是「两份表默默不一致」，现在是显式、可测、有理由的一条。
 */
export const FORUM_MENTION_RE = /人民法院/;

/**
 * 该条款类型是否在文本中被提及。`includeForumMentions` 只影响「管辖」
 * （见 `FORUM_MENTION_RE` 的说明）。
 */
export function clauseTypeMentionedIn(
  text: string,
  clauseType: string,
  opts?: { includeForumMentions?: boolean },
): boolean {
  if (clauseType === "管辖" && opts?.includeForumMentions === true) {
    if (FORUM_MENTION_RE.test(text)) {
      return true;
    }
  }
  const row = CLAUSE_TYPE_KEYWORDS.find((r) => r.id === clauseType);
  return row ? row.re.test(text) : false;
}
