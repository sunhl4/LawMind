/**
 * Insights — W10 公开入口。
 *
 * 把桌面 MatterWorkbench 内嵌的 8 层"行为信号 → 收敛建议 → 产品实验 → 路线图"
 * 链路，抽到 src/lawmind/insights/ 的 4 个纯函数：
 *   - computeBehaviorSummary      （单案件行为摘要）
 *   - computeConvergenceHints     （收敛建议）
 *   - computeProductExperiments   （产品实验候选）
 *   - computeRoadmapCards         （跨案件路线图候选）
 */

export { computeBehaviorSummary } from "./compute-behavior-summary.js";
export { computeConvergenceHints } from "./compute-convergence-hints.js";
export { computeProductExperiments } from "./compute-product-experiments.js";
export { computeRoadmapCards } from "./compute-roadmap-cards.js";
export type {
  BehaviorSummary,
  ConvergenceHint,
  ConvergenceHintTone,
  InteractionAction,
  InteractionEvent,
  ProductExperimentItem,
  RoadmapCard,
} from "./types.js";
