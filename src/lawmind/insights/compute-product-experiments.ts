/**
 * computeProductExperiments — 把行为信号映射成可验证的产品实验清单。
 * 纯函数。
 */

import type { BehaviorSummary, ProductExperimentItem } from "./types.js";

export function computeProductExperiments(summary: BehaviorSummary): ProductExperimentItem[] {
  const items: ProductExperimentItem[] = [];

  if (summary.reviewOpenCount >= 5) {
    items.push({
      key: "exp_inline_acceptance_score",
      title: "在案件页内联验收门禁评分",
      hypothesis: "如果律师在案件页就能看到验收门禁评分，进入审核台的次数会下降 ≥ 30%。",
      validation: "对比上线前后 7 天 review_open 计数，预期下降。",
      signal: `当前 7 日 review_open 计数 ${summary.reviewOpenCount}（来自 BehaviorSummary）。`,
      priority: "high",
    });
  }

  if (summary.memorySaveCount >= 3) {
    items.push({
      key: "exp_inspector_in_navbar",
      title: "把 Memory Inspector 提升到主导航",
      hypothesis:
        "把 Memory Inspector 放到顶层导航后，律师采纳 pending suggestions 的延迟（创建→采纳）会下降。",
      validation: "对比 7 日内采纳延迟分布。",
      signal: `7 日内已成功采纳 ${summary.memorySaveCount} 条建议。`,
      priority: "medium",
    });
  }

  if (summary.caseWriteCount >= 4) {
    items.push({
      key: "exp_case_template",
      title: '推出"案件模板"以减少 CASE 重复填写',
      hypothesis: "提供新案件模板预填后，write_case_note 计数将在新案件首日下降 ≥ 50%。",
      validation: "对比启用模板与未启用模板案件的首日计数。",
      signal: `7 日内 case_write 计数 ${summary.caseWriteCount}。`,
      priority: "medium",
    });
  }

  if (summary.dominantSurface) {
    items.push({
      key: `exp_surface_${summary.dominantSurface.label}`,
      title: `优化主导面板 "${summary.dominantSurface.label}"`,
      hypothesis: "主导面板获得最多触达，UX 投入产出比最高。",
      validation: "在该面板试做收敛动作（合并按钮、提示重要字段）后，观察律师停留时长与跳转率。",
      signal: `该面板 7 日内触发 ${summary.dominantSurface.count} 次。`,
      priority: "low",
    });
  }

  return items;
}
