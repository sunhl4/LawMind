/**
 * Compile-stage chronology from dated snippets in the instruction.
 * Linear list (not markdown tables). Do not invent dates.
 */

import { extractDatedSnippets } from "./cn-date.js";

export function formatChronologyBody(instruction: string): string {
  const rows = extractDatedSnippets(instruction);
  if (rows.length === 0) {
    return [
      "按材料抽日期，线性列出，不用表格。读不到的日期标【待补充】，不要编。",
      "1. 【待补充】日期 —— 【待补充】事件 —— 来源：交办",
    ].join("\n");
  }
  const lines = rows.map((row, i) => `${i + 1}. ${row.ymd} —— ${row.fact} —— 来源：交办`);
  return ["按材料抽日期，线性列出，不用表格。底层时间线中立。", ...lines].join("\n");
}
