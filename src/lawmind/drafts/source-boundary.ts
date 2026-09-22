/**
 * 已核验 / 未核验 / 缺口 — anti-fabrication columns for opinion and research drafts.
 * Never blocks. Mail/Word tracked redline do not use these keyword-draft scaffolds.
 */

import type { ResearchBundle } from "../types.js";

export function formatSourceBoundaryBody(bundle: ResearchBundle): string {
  const verified = bundle.sources.filter(
    (s) => !s.demo && Boolean(s.citation || s.caseNumber || s.url),
  );
  const unverified = bundle.sources.filter((s) => s.demo || !(s.citation || s.caseNumber || s.url));
  const verifiedLines =
    verified.length > 0
      ? verified.map((s) => `- ${s.citation ?? s.caseNumber ?? s.title}`).join("\n")
      : "- 【待核实】本回合无已核验法条或案号。";
  const unverifiedLines =
    unverified.length > 0
      ? unverified.map((s) => `- ${s.demo ? "演示语料" : "未挂引用"}：${s.title}`).join("\n")
      : "- 材料原文与模型记忆不得当作已核验法条。";
  const gaps =
    bundle.missingItems.length > 0
      ? bundle.missingItems.map((m) => `- ${m}`).join("\n")
      : "- 【待核实】会改变结论的来源缺口";
  return ["已核验：", verifiedLines, "未核验：", unverifiedLines, "缺口：", gaps].join("\n");
}

/** Text-only sign-off. Never a UI gate and never a mail/Word export stop. */
export function formatSignOffLine(bundle: ResearchBundle): string {
  if (bundle.claims.length === 0 || bundle.missingItems.length > 0) {
    return "签署结论：结论待定。缺事实仍分级写风险，不要空白暂停。";
  }
  return "签署结论：非正式签署结论；按下列意见继续改稿。";
}
