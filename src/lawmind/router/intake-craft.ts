/**
 * Intake craft — Soft Ask principles (Cursor/Claude style), not keyword freeze.
 * Body is the builtin skill markdown (single source).
 */

import { readBuiltinSkillMarkdown } from "../skills/lawyer-capabilities.js";

export const INTAKE_CRAFT_SKILL =
  readBuiltinSkillMarkdown("intake-required-inputs") ??
  "# Skill · 交办 Intake（Soft Ask）\n\n材料齐备时不冻写；高风险空跑才硬澄清。";

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
