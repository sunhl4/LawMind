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
  if (!kind) {
    return "系统记录";
  }
  if (kind === "ui.matter_action") {
    return "律师动作";
  }
  if (kind === "ui.firstrun_wizard_completed") {
    return "首跑向导完成";
  }
  if (kind === "ui.firstrun_acceptance_ready") {
    return "首跑验收就绪";
  }
  const map: Record<string, string> = {
    "review.completed": "签批完成",
    "review.submitted": "提交签批",
    "delegation.completed": "委派完成",
    "delegation.failed": "委派失败",
    "delegation.timeout": "委派超时",
    "draft.rendered": "已导出文书",
    "draft.approved": "草稿已通过",
    "draft.rejected": "草稿已驳回",
    "draft.modified": "草稿需修改",
    "tool.approved": "工具已批准",
    "tool.rejected": "工具已拒绝",
    "approval.requested": "发起审批",
    "approval.resolved": "审批已决",
    "matter.created": "新建案件",
    "matter.updated": "更新案件",
    "mail.synced": "邮件已同步",
    "mail.sent": "邮件已发送",
    "automation.run": "交办运行",
    "memory.adopted": "记忆已采纳",
    "memory.suggested": "记忆建议",
    "workflow.completed": "流程完成",
    "workflow.failed": "流程失败",
  };
  if (map[kind]) {
    return map[kind];
  }
  // Soften dotted engish codes: tool.execute → tool · execute
  if (kind.includes(".")) {
    return kind
      .split(".")
      .map((p) => p.replace(/[_-]+/g, " "))
      .join(" · ");
  }
  return kind;
}

export function parseMatterInteractionEvent(event: AuditEventRow): {
  action: "open_review" | "save_upgrade_suggestion" | "write_case_note" | "unknown";
  surface?: string;
  label?: string;
} {
  const detail = event.detail?.trim() ?? "";
  const reviewMatch =
    /^案件工作台动作：从 (.+?) (?:打开改稿(?:预览)?|进入(?:审核台|文书台|改稿))；来源 (.+)。$/.exec(detail);
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
      return "卡点原因";
    case "cognition":
      return "认知页";
    case "case-focus":
      return "案件焦点";
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
      return "先向客户发起补充提问，并把缺口写入案件档案或任务备注。";
    case "need_evidence":
      return "先补证据目录或事实清单，再继续推理和交付。";
    case "need_conflict_check":
      return "先完成冲突检查并记录结果，避免后续工作无效。";
    case "need_lawyer_review":
      return "先打开改稿并审阅，再决定是否导出。";
    case "need_partner_approval":
      return "先提交高风险审批或请示上级，再继续执行。";
    case "ready_to_draft":
      return "先根据审核意见修订草稿，再回到改稿页或交付动作。";
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
    return "可升律师级记忆。";
  }
  if (label.includes("律所")) {
    return "可升律所规则。";
  }
  if (label.includes("条款") || label.includes("Playbook")) {
    return "可升常用 playbook。";
  }
  if (label.includes("案件") || label.includes("策略")) {
    return "可沉淀案件策略。";
  }
  return "可升长期记忆。";
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
