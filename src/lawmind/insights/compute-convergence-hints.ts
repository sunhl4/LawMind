/**
 * computeConvergenceHints — 从 BehaviorSummary 推导收敛建议（"做什么")。
 * 纯函数。
 */

import type { BehaviorSummary, ConvergenceHint } from "./types.js";

export function computeConvergenceHints(summary: BehaviorSummary): ConvergenceHint[] {
  const hints: ConvergenceHint[] = [];

  if (summary.total === 0) {
    return hints;
  }

  if (summary.reviewOpenCount >= 5 && summary.dominantAction === "review") {
    hints.push({
      key: "review_loop_dominant",
      title: "审核往返过多，建议在案件页直接给草稿打分",
      detail: `近期已有 ${summary.reviewOpenCount} 次从案件页跳到审核台，说明草稿把关仍是当前主工作面。可考虑在案件页直接展示验收门禁评分，减少跳转。`,
      actionLabel: "在 cockpit 增加验收摘要",
      tone: "warn",
    });
  }

  if (summary.memorySaveCount >= 3) {
    hints.push({
      key: "memory_adoption_active",
      title: "认知升级机制开始生效，建议进一步突出 Inspector",
      detail: `已采纳 ${summary.memorySaveCount} 条认知升级建议，可在导航更显眼的位置暴露 Memory Inspector，避免遗漏 pending suggestions。`,
      actionLabel: "把 Inspector 放进案件 tab 栏",
      tone: "success",
    });
  }

  if (summary.caseWriteCount >= 4) {
    hints.push({
      key: "case_write_dominant",
      title: "CASE 补档频繁，建议固化为模板",
      detail: `已 ${summary.caseWriteCount} 次回写案件档案；这些字段值得抽成案件模板，新案件直接预填，减少重复劳动。`,
      actionLabel: "新增案件模板编辑器",
      tone: "info",
    });
  }

  for (const item of summary.topLabels) {
    if (item.count >= 3) {
      hints.push({
        key: `label_repeat_${item.label}`,
        title: `"${item.label}" 已出现 ${item.count} 次，建议沉淀为快捷动作`,
        detail: `同一标签在多次律师动作中复现，可在案件页加一个一键执行按钮，让律师跳过菜单。`,
        actionLabel: "新增快捷按钮",
        tone: "neutral",
      });
    }
  }

  return hints;
}
