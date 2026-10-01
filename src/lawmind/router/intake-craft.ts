/**
 * Intake craft — Soft Ask principles (Cursor/Claude style), not keyword freeze.
 * Body is the builtin skill markdown (single source).
 */

import { readBuiltinSkillMarkdown } from "../skills/lawyer-capabilities.js";

export const INTAKE_CRAFT_SKILL =
  readBuiltinSkillMarkdown("intake-required-inputs") ??
  "# Skill · 交办 Intake（Soft Ask）\n\n材料齐备时不冻写；空跑也不暂停，按假设起草并标【待核实】。";

export function formatIntakeSoftAskBlock(
  questions: Array<{ key: string; question: string }>,
  opts?: { highRiskEmptyRun?: boolean },
): string {
  if (questions.length === 0) {
    return "";
  }
  const lines = questions.map((q, i) => `${i + 1}. （${q.key}）${q.question}`);
  if (opts?.highRiskEmptyRun === true) {
    // 高风险空跑（律师函/诉讼文书且无档案无材料）：端到端口径——不暂停、不追问，
    // 按合理假设起草，缺口留在文内与回复里，律师在修订视图或下一句补正。
    return [
      "## 交办 Soft Ask（高风险空跑 · 不暂停、不冻写）",
      "下列要点本案档案与材料中未能确定。**不要停下等律师回答，也不要用一轮对话去追问**：",
      "按合理假设直接起草，在文中用【待核实：…】逐处标注，并在回复末尾用一小节列出这些假设（律师会在修订里改，或直接回一句补充）。",
      ...lines,
    ].join("\n");
  }
  return [
    "## 交办 Soft Ask（不冻结写工具）",
    "下列信息若仍不确定，可在推进中向律师追问或标【待补充】；材料已钉选时优先推断并执行：",
    ...lines,
  ].join("\n");
}
