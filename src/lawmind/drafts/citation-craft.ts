/**
 * Citation grounding craft — coach anchors; hard render block unchanged.
 */

export const CITATION_GROUNDING_SKILL = [
  "# Skill · 引用锚定（Citation Grounding）",
  "",
  "正式交付的结论须可追溯；臆造法条或空引用不得装作已核验。",
  "",
  "## 原则",
  "1. **先检索再断言**：关键规范/案例主张应能指向本次 `research_task` / bundle 来源 ID。",
  "2. **章节挂锚**：长段结论在 `citations` 写上来源编号；无法锚定则标【待核实】。",
  "3. **门禁只拦导出**：引用完整性失败时仍可改草稿；补锚或改 citationMode 后再 `render_document`。",
  "4. **缓办诚实**：查不到权威来源时写明缺口，勿编造条款号。",
  "",
  "## 失败时下一步",
  "- 缺来源 ID → 重跑检索或改写 citations 对齐 bundle",
  "- 长段未锚定 → 为该节补 citations 或缩短未锚正文",
  "- 严格援引模式 → 改稿页核对 Citation Banner，或请律师改 assisted",
].join("\n");

/** Appended to citation-gate tool/render errors (hard block unchanged). */
export function formatCitationGateCoach(detail?: string): string {
  const d = detail?.trim();
  return [
    "【引用教练】",
    "硬门禁仍拦截正式 Word 导出；请按 Citation Skill：核对缺哪些来源 ID / 未锚定章节，补 `research_task` 或章节 citations 后重试 `render_document`。",
    d ? `详情：${d}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
