/**
 * Insights — W10。
 *
 * 把桌面 MatterWorkbench 内嵌的 8 层"行为信号 → 收敛建议 → 产品实验 → 路线图卡"链路
 * 抽到 src/lawmind/insights/ 的纯函数，全部 pure / 易测试。
 *
 * 输入：归一化的 InteractionEvent / DraftSummary 等 plain DTO；
 * 输出：BehaviorSummary / ConvergenceHint / ProductExperimentItem / RoadmapCard。
 */

export type InteractionAction =
  | "open_review"
  | "save_upgrade_suggestion"
  | "write_case_note"
  | "unknown";

export type InteractionEvent = {
  /** 来源审计事件 kind（"ui.matter_action" 或 "ux.matter_action"） */
  kind: "ui.matter_action" | "ux.matter_action";
  matterId: string;
  taskId: string;
  timestamp: string;
  action: InteractionAction;
  surface?: string;
  label?: string;
};

export type BehaviorSummary = {
  total: number;
  reviewOpenCount: number;
  memorySaveCount: number;
  caseWriteCount: number;
  latestAt?: string;
  dominantSurface?: { label: string; count: number };
  /** review / memory / case 三档主导动作 */
  dominantAction: "review" | "memory" | "case";
  topLabels: Array<{ label: string; count: number }>;
};

export type ConvergenceHintTone = "warn" | "info" | "success" | "neutral";

export type ConvergenceHint = {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: ConvergenceHintTone;
};

export type ProductExperimentItem = {
  key: string;
  title: string;
  hypothesis: string;
  validation: string;
  signal: string;
  priority: "high" | "medium" | "low";
};

export type RoadmapCard = {
  key: string;
  title: string;
  score: number;
  rationale: string;
  urgency: "now" | "next" | "later";
  readiness: "validated" | "emerging" | "watching";
  benefit: string;
  risk: string;
  matterCount: number;
  totalEvents: number;
  latestAt?: string;
};
