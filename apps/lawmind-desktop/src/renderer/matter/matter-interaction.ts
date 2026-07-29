/**
 * Matter workbench — interaction parsing, blocking labels, cognition types.
 */
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { CaseFocusContext } from "./matter-case-focus.js";

export type MatterSearchHit = {
  section: string;
  text: string;
  taskId?: string;
  /** 命中来源：案件结构化索引 / 审计 FTS / 会话 FTS */
  source?: "matter" | "audit" | "session";
};

export type AuditEventRow = { kind?: string; detail?: string; timestamp?: string; taskId?: string };
export type AdoptedSuggestionRecord = {
  key: string;
  target: "lawyer" | "assistant";
  label: string;
  matterId?: string | null;
  taskId?: string | null;
  draftTitle?: string | null;
  savedAt: string;
  rawBody?: string;
};

export type PersistentAdoptionItem = {
  target: "lawyer" | "assistant";
  stamp: string;
  body: string;
};

export type AdoptionHistoryInsight = {
  total: number;
  lawyerCount: number;
  assistantCount: number;
  crossMatterCount: number;
  latestSavedAt?: string;
  repeatedLabels: Array<{ label: string; count: number; matterIds: string[]; latestSavedAt?: string }>;
};

export type MatterInteractionSummary = {
  total: number;
  latestAt?: string;
  reviewOpenCount: number;
  memorySaveCount: number;
  caseWriteCount: number;
  dominantSurface?: { label: string; count: number };
  dominantActionLabel: string;
  dominantActionHint: string;
  topLabels: Array<{ label: string; count: number }>;
};

export type MatterRecommendationTarget =
  | {
      type: "review";
      taskId: string;
      sourceSurface: string;
      sourceLabel: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
    }
  | { type: "case"; context?: CaseFocusContext }
  | { type: "cognition" }
  | { type: "none" };

export type MatterConvergenceSuggestion = {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: "warn" | "info" | "success" | "neutral";
  target: MatterRecommendationTarget;
};

export type MatterProductAdaptationSuggestion = {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: "warn" | "info" | "success" | "neutral";
  target: MatterRecommendationTarget;
};

export type MatterProductExperimentItem = {
  key: string;
  title: string;
  hypothesis: string;
  validation: string;
  signal: string;
  priority: "high" | "medium" | "low";
  actionLabel: string;
  target: MatterRecommendationTarget;
};

export type MatterCrossExperimentRollupItem = {
  key: string;
  title: string;
  matterCount: number;
  totalEvents: number;
  latestAt?: string;
  exampleMatterIds: string[];
};

export type MatterRoadmapCandidate = {
  key: string;
  title: string;
  score: number;
  rationale: string;
  urgency: "now" | "next" | "later";
  readiness: "validated" | "emerging" | "watching";
  owner: string;
  benefit: string;
  risk: string;
  matterCount: number;
  totalEvents: number;
  latestAt?: string;
  localSuggestion?: { target: MatterRecommendationTarget };
};

export type MatterCognitionBoard = {
  observedDraftCount: number;
  reasoningDraftCount: number;
  missingReasoningCount: number;
  missingCitationCount: number;
  uniqueMemoryLayerCount: number;
  injectedMemoryLayerCount: number;
  candidateMemoryLayerCount: number;
  missingMemoryLayerCount: number;
  uncoveredFrequentLayerCount: number;
  newestDraftAt?: string;
  oldestDraftAt?: string;
  topMemoryLayers: Array<{ label: string; count: number; injected: boolean }>;
  memoryCategories: Array<{
    key: "injected" | "candidate" | "missing";
    title: string;
    count: number;
    hint: string;
  }>;
  missingMemoryLayers: Array<{ label: string; count: number }>;
  upgradeSuggestions: Array<{
    label: string;
    count: number;
    recommendation: string;
  }>;
  draftCoverage: Array<{
    taskId: string;
    title: string;
    status: ArtifactDraft["reviewStatus"];
    hasReasoning: boolean;
    memoryLayerCount: number;
    citationState: "ok" | "warn" | "missing";
    createdAt: string;
  }>;
};

export type OperationsFocus = "all" | "review" | "modified" | "delivery" | "highRisk";
export type OperationsSort = "priority" | "recent" | "title";

export function auditKindLabel(kind?: string): string {
  if (kind === "ui.matter_action") {
    return "律师动作";
  }
  if (kind === "ui.firstrun_wizard_completed") {
    return "首跑向导完成";
  }
  if (kind === "ui.firstrun_acceptance_ready") {
    return "首跑验收就绪";
  }
  return kind ?? "audit";
}

export function parseMatterInteractionEvent(event: AuditEventRow): {
  action: "open_review" | "save_upgrade_suggestion" | "write_case_note" | "unknown";
  surface?: string;
  label?: string;
} {
  const detail = event.detail?.trim() ?? "";
  const reviewMatch = /^案件工作台动作：从 (.+?) 进入(?:审核台|文书台)；来源 (.+)。$/.exec(detail);
  if (reviewMatch) {
    return {
      action: "open_review",
      surface: reviewMatch[1]?.trim(),
      label: reviewMatch[2]?.trim(),
    };
  }
  const memoryMatch = /^案件工作台动作：从 (.+?) 采纳认知升级建议并写入(?:律师档案|助手档案)；建议 (.+)。$/.exec(detail);
  if (memoryMatch) {
    return {
      action: "save_upgrade_suggestion",
      surface: memoryMatch[1]?.trim(),
      label: memoryMatch[2]?.trim(),
    };
  }
  const caseMatch = /^案件工作台动作：从 (.+?) 写回 CASE 档案；section .+?；版本 .+?；主题 (.+)。$/.exec(detail);
  if (caseMatch) {
    return {
      action: "write_case_note",
      surface: caseMatch[1]?.trim(),
      label: caseMatch[2]?.trim(),
    };
  }
  return { action: "unknown" };
}

export function matterInteractionSurfaceLabel(surface?: string): string {
  switch (surface) {
    case "overview-summary":
      return "概览摘要卡";
    case "queue":
      return "工作队列";
    case "approval":
      return "审批节点";
    case "draft-status":
      return "交付物状态";
    case "blocked-by":
      return "Blocked By";
    case "cognition":
      return "认知页";
    case "case-focus":
      return "CASE 焦点";
    case "overview":
      return "案件概览";
    default:
      return surface ?? "未知入口";
  }
}

export function blockingReasonLabel(kind: WorkQueueItem["kind"]): string {
  switch (kind) {
    case "need_client_input":
      return "等待客户补充信息";
    case "need_evidence":
      return "证据或事实材料不完整";
    case "need_conflict_check":
      return "尚未完成冲突检查";
    case "need_lawyer_review":
      return "律师审核尚未完成";
    case "need_partner_approval":
      return "需要上级或高风险审批";
    case "ready_to_draft":
      return "需要先完成修订再继续";
    case "ready_to_render":
      return "已可交付，但尚未执行渲染";
    case "blocked_by_deadline":
      return "期限压力阻塞当前节奏";
    case "blocked_by_missing_strategy":
      return "案件策略和争点尚未成形";
    default:
      return "工作队列阻塞";
  }
}

export function blockingNextAction(kind: WorkQueueItem["kind"]): string {
  switch (kind) {
    case "need_client_input":
      return "先向客户发起补充提问，并把缺口写入 CASE 或任务备注。";
    case "need_evidence":
      return "先补证据目录或事实清单，再继续推理和交付。";
    case "need_conflict_check":
      return "先完成冲突检查并记录结果，避免后续工作无效。";
    case "need_lawyer_review":
      return "先进入文书台完成律师审阅，再决定是否渲染交付。";
    case "need_partner_approval":
      return "先提交高风险审批或请示上级，再继续执行。";
    case "ready_to_draft":
      return "先根据审核意见修订草稿，再回到文书台或交付动作。";
    case "ready_to_render":
      return "已满足交付前置条件，下一步应执行渲染和发送。";
    case "blocked_by_deadline":
      return "先重排优先级，围绕最近期限压缩准备路径。";
    case "blocked_by_missing_strategy":
      return "先补齐核心争点、目标和策略底线，再进入细化执行。";
    default:
      return "先处理队列项再继续。";
  }
}

export function memoryUpgradeRecommendation(label: string): string {
  if (label.includes("律师")) {
    return "如果这类偏好反复出现，建议提升为律师级核心记忆，减少每次重复检索。";
  }
  if (label.includes("律所")) {
    return "如果这是稳定交付规则，建议整理进律所级规则并考虑进入核心提示。";
  }
  if (label.includes("条款") || label.includes("Playbook")) {
    return "如果这类条款模式持续高频出现，建议升级为常用审查模板并考虑强制注入。";
  }
  if (label.includes("案件") || label.includes("策略")) {
    return "如果案件策略反复被检索，建议把关键决策沉淀为 MATTER_STRATEGY 核心段落。";
  }
  return "如果这层信息持续高频命中，建议升级为更稳定的核心记忆而不是临时检索。";
}

export function sectionWriteTarget(
  section?: CaseFocusContext["section"],
): "core_issue" | "risk" | "artifact" | "task_goal" {
  switch (section) {
    case "core-issues":
      return "core_issue";
    case "artifacts":
      return "artifact";
    case "case-md":
      return "task_goal";
    case "risk-notes":
    default:
      return "risk";
  }
}
