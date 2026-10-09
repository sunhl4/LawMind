/**
 * Review memos must keep conflicts, material gaps, and one concrete edit.
 * Positive extracts do not replace those three.
 */

const REVIEWISH_RE =
  /审查|审阅|意见书|备忘录|\breview\b|\bidentify issues\b|\bissue memorandum\b|\bsummary memo\b|\bstructured memo\b|\bcategorized memo\b/i;

const PAPER_RE = /合同|协议|条款|\bagreements?\b|\bcovenants?\b|\bmemorandum\b/i;

export const ISSUE_LEDGER_MARKER = "<!--lm-issue-ledger-->";

export function instructionNeedsIssueLedger(instruction: string | undefined): boolean {
  const text = instruction?.trim() ?? "";
  return REVIEWISH_RE.test(text) && PAPER_RE.test(text);
}

export function formatIssueLedgerBlock(): string {
  return [
    ISSUE_LEDGER_MARKER,
    "审查或问题备忘录先交律师点名的文件：用 write_document 写到该相对路径，写完再结束。",
    "第一段必须逐项摘材料里已经写明的期限、范围、定义、金额、法院和义务。这些摘录不能省，也不能为了后面三类删掉。",
    "摘录之后另列三类，不能用摘录代替：",
    "- 多份材料对同一事项冲突：并列两说，不要静默择一。",
    "- 会改变效力、范围或救济的缺失：写明未见哪一项，不要把没写的条款编进去。",
    "- 每个问题一条可落字的改法。",
    "效力与执行风险也要写：条款可能无效、与其他文件冲突后的空窗、不对称义务、报复或签约后请求是否被不当覆盖。材料不是中国法文本时，以材料原文与其管辖法为准，不要改去检索中国法凑条号。",
  ].join("\n");
}
