/**
 * Intake craft — Soft Ask principles (Cursor/Claude style), not keyword freeze.
 */

export const INTAKE_CRAFT_SKILL = [
  "# Skill · 交办 Intake（Soft Ask）",
  "",
  "在材料/钉源已齐时，勿为「审查重点」等机械追问冻结写工具；用最短必要问题补关键缺口。",
  "",
  "## 原则",
  "1. **材料优先**：已有合同路径、邮件附件、@钉源或 CASE 主体时，推断立场与重点并执行。",
  "2. **软问不冻写**：一般缺口写入对话追问即可；只读/检索始终可继续。",
  "3. **硬澄清仅高风险空跑**：如律师函缺收件人且无任何材料时，才暂停重写工具。",
  "4. **交办表单优先**：律师已填【交办】结构化表单则不再追问。",
  "",
  "## Required Inputs（按交付物，有则用、无则【待补充】）",
  "- 合同起草：双方主体、标的、核心价款/期限（可占位）",
  "- 合同审查：文本来源；重点与立场可从当事人/邮件推断",
  "- 律师函：收函对象、事实主张、履行期限",
  "- 报告/PPT：主题、读者、必覆盖要点",
].join("\n");

export function formatIntakeSoftAskBlock(
  questions: Array<{ key: string; question: string }>,
): string {
  if (questions.length === 0) {
    return "";
  }
  const lines = questions.map((q, i) => `${i + 1}. （${q.key}）${q.question}`);
  return [
    "## 交办 Soft Ask（不冻结写工具）",
    "下列信息若仍不确定，可在推进中向律师追问或标【待补充】；材料已钉选时优先推断并执行：",
    ...lines,
  ].join("\n");
}
