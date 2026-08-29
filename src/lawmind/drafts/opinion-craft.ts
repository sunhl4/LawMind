/**
 * Opinion / memo craft skill for non-tracked (PDF etc.) mail-contract path.
 */

export const OPINION_CRAFT_SKILL = [
  "# Skill · 合同审查意见书（Craft）",
  "",
  "在无法导出 Word 原件审阅痕迹时，交付可核验的审查意见书（非空话摘要）。",
  "",
  "## 原则",
  "1. **通读附件**（analyze_document），结合邮件要求形成争点清单。",
  "2. **覆盖完整**：实质风险点须有结论、风险等级与修改建议；缓办须写理由。",
  "3. **可追溯**：关键判断能指向附件段落或邮件表述；禁止臆造法条。",
  "4. **形式克制**：意见书结构清晰（结论 / 风险 / 建议），勿堆砌无关润色。",
  "",
  "## 工作流",
  "`analyze_document` → `draft_document`（contract.review）→ `prepare_outbound_mail`（待拍板；勿 send_email）。",
].join("\n");
