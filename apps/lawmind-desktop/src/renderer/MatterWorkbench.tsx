/**
 * 案件工作台 — 列表、摘要、CASE 档案、任务/草稿/审计时间线、案件内搜索。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { ArtifactDraft, MatterOverview, MatterSummary, TaskRecord } from "../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../src/lawmind/core/contracts.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { LawmindReasoningCollapsible } from "./LawmindReasoningCollapsible";

type MatterSearchHit = {
  section: string;
  text: string;
  taskId?: string;
};

type AuditEventRow = { kind?: string; detail?: string; timestamp?: string; taskId?: string };
type CaseFocusContext = {
  title: string;
  hint: string;
  query?: string;
  section?: "core-issues" | "risk-notes" | "artifacts" | "case-md";
};
type AdoptedSuggestionRecord = {
  key: string;
  target: "lawyer" | "assistant";
  label: string;
  matterId?: string | null;
  taskId?: string | null;
  draftTitle?: string | null;
  savedAt: string;
  rawBody?: string;
};

type PersistentAdoptionItem = {
  target: "lawyer" | "assistant";
  stamp: string;
  body: string;
};

type AdoptionHistoryInsight = {
  total: number;
  lawyerCount: number;
  assistantCount: number;
  crossMatterCount: number;
  latestSavedAt?: string;
  repeatedLabels: Array<{ label: string; count: number; matterIds: string[]; latestSavedAt?: string }>;
};

type MatterInteractionSummary = {
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

type MatterRecommendationTarget =
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

type MatterConvergenceSuggestion = {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: "warn" | "info" | "success" | "neutral";
  target: MatterRecommendationTarget;
};

type MatterProductAdaptationSuggestion = {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: "warn" | "info" | "success" | "neutral";
  target: MatterRecommendationTarget;
};

type MatterProductExperimentItem = {
  key: string;
  title: string;
  hypothesis: string;
  validation: string;
  signal: string;
  priority: "high" | "medium" | "low";
  actionLabel: string;
  target: MatterRecommendationTarget;
};

type MatterCrossExperimentRollupItem = {
  key: string;
  title: string;
  matterCount: number;
  totalEvents: number;
  latestAt?: string;
  exampleMatterIds: string[];
};

type MatterRoadmapCandidate = {
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

type CaseDraftVariant = "conservative" | "standard" | "assertive";
type MatterCognitionBoard = {
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

type OperationsFocus = "all" | "review" | "modified" | "delivery" | "highRisk";
type OperationsSort = "priority" | "recent" | "title";

type Props = {
  apiBase: string;
  refreshVersion?: number;
  assistantId?: string;
  /** 在对话中带上案件 ID（matter 参数） */
  onUseInChat?: (matterId: string) => void;
  /** 打开审核台并预选相关草稿 */
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
};

function DraftCitationBadge(props: { cit: DraftCitationIntegrityView | undefined }): ReactNode {
  const { cit } = props;
  if (!cit) {
    return null;
  }
  if (!cit.checked) {
    return (
      <span className="lm-matter-cit lm-matter-cit-skip" title="无检索快照，无法对照 bundle">
        无快照
      </span>
    );
  }
  if (cit.ok) {
    return (
      <span className="lm-matter-cit lm-matter-cit-ok" title="章节引用 ID 均在本次检索 bundle 内">
        引用OK
      </span>
    );
  }
  return (
    <span
      className="lm-matter-cit lm-matter-cit-warn"
      title={`以下 ID 不在检索 bundle：${cit.missingSourceIds.join(", ")}`}
    >
      引用待核
    </span>
  );
}

function queueKindLabel(kind: WorkQueueItem["kind"]): string {
  switch (kind) {
    case "need_client_input":
      return "待客户输入";
    case "need_evidence":
      return "待补证据";
    case "need_conflict_check":
      return "待冲突检查";
    case "need_lawyer_review":
      return "待律师审核";
    case "need_partner_approval":
      return "待上级审批";
    case "ready_to_draft":
      return "可继续起草";
    case "ready_to_render":
      return "可渲染交付";
    case "blocked_by_deadline":
      return "期限阻塞";
    case "blocked_by_missing_strategy":
      return "策略未完善";
  }
}

function approvalStatusLabel(status: ApprovalRequest["status"]): string {
  switch (status) {
    case "pending":
      return "待审批";
    case "approved":
      return "已批准";
    case "rejected":
      return "已驳回";
    case "needs_changes":
      return "需修改";
  }
}

function reviewStatusLabel(status: ArtifactDraft["reviewStatus"]): string {
  switch (status) {
    case "pending":
      return "待审核";
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "modified":
      return "需修改";
  }
}

function auditKindLabel(kind?: string): string {
  if (kind === "ui.matter_action") {
    return "律师动作";
  }
  return kind ?? "audit";
}

function parseMatterInteractionEvent(event: AuditEventRow): {
  action: "open_review" | "save_upgrade_suggestion" | "write_case_note" | "unknown";
  surface?: string;
  label?: string;
} {
  const detail = event.detail?.trim() ?? "";
  const reviewMatch = /^案件工作台动作：从 (.+?) 进入审核台；来源 (.+)。$/.exec(detail);
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

function matterInteractionSurfaceLabel(surface?: string): string {
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

function priorityLabel(priority: WorkQueueItem["priority"]): string {
  switch (priority) {
    case "critical":
      return "紧急";
    case "high":
      return "高";
    case "normal":
      return "中";
    case "low":
      return "低";
  }
}

function formatShortDateTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

function blockingReasonLabel(kind: WorkQueueItem["kind"]): string {
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
  }
}

function blockingNextAction(kind: WorkQueueItem["kind"]): string {
  switch (kind) {
    case "need_client_input":
      return "先向客户发起补充提问，并把缺口写入 CASE 或任务备注。";
    case "need_evidence":
      return "先补证据目录或事实清单，再继续推理和交付。";
    case "need_conflict_check":
      return "先完成冲突检查并记录结果，避免后续工作无效。";
    case "need_lawyer_review":
      return "先进入审核台完成律师审阅，再决定是否渲染交付。";
    case "need_partner_approval":
      return "先提交高风险审批或请示上级，再继续执行。";
    case "ready_to_draft":
      return "先根据审核意见修订草稿，再回到审核或交付动作。";
    case "ready_to_render":
      return "已满足交付前置条件，下一步应执行渲染和发送。";
    case "blocked_by_deadline":
      return "先重排优先级，围绕最近期限压缩准备路径。";
    case "blocked_by_missing_strategy":
      return "先补齐核心争点、目标和策略底线，再进入细化执行。";
  }
}

function memoryUpgradeRecommendation(label: string): string {
  if (label.includes("律师")) {
    return "如果这类偏好反复出现，建议提升为律师级核心记忆，减少每次重复检索。";
  }
  if (label.includes("律所")) {
    return "如果这是稳定交付规则，建议整理进律所级规则并考虑进入核心提示。";
  }
  if (label.includes("条款") || label.includes("Playbook")) {
    return "如果这类条款模式持续高频出现，建议升级为常用 playbook 并考虑核心注入。";
  }
  if (label.includes("案件") || label.includes("策略")) {
    return "如果案件策略反复被检索，建议把关键决策沉淀为 MATTER_STRATEGY 核心段落。";
  }
  return "如果这层信息持续高频命中，建议升级为更稳定的核心记忆而不是临时检索。";
}

function sectionWriteTarget(
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

function buildCaseFocusDraft(context: CaseFocusContext, variant: CaseDraftVariant): string {
  const toneLead =
    variant === "conservative"
      ? "建议先做最小必要补充："
      : variant === "assertive"
        ? "建议优先推动形成明确处理结论："
        : "建议补充案件记录：";
  if (context.section === "core-issues") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议尽快明确的核心法律争点：" : "下一步需要澄清的法律问题："
    }\n- ${
      variant === "conservative" ? "暂不确定但需记录的边界：" : "建议补充的判断标准或目标："
    }`;
  }
  if (context.section === "artifacts") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议立即推进的交付物：" : "计划新增或更新的交付物："
    }\n- ${variant === "conservative" ? "当前仍需等待的前置条件：" : "为交付准备需补齐的说明："}`;
  }
  if (context.section === "case-md") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议立即明确的目标或底线：" : "建议先明确的目标或底线："
    }\n- ${variant === "conservative" ? "当前尚不宜推进的原因：" : "下一步策略动作："}`;
  }
  return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
    variant === "assertive" ? "建议立即补齐的信息或证据：" : "仍待补齐的信息或证据："
  }\n- ${variant === "conservative" ? "当前已知风险边界：" : "补充完成后的下一步动作："}`;
}

export function MatterWorkbench(props: Props) {
  const { apiBase, refreshVersion = 0, assistantId, onUseInChat, onOpenReview } = props;
  const [overviews, setOverviews] = useState<MatterOverview[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MatterSummary | null>(null);
  const [overview, setOverview] = useState<MatterOverview | null>(null);
  const [caseMemory, setCaseMemory] = useState("");
  const [caseTruncated, setCaseTruncated] = useState(false);
  const [coreIssues, setCoreIssues] = useState<string[]>([]);
  const [riskNotes, setRiskNotes] = useState<string[]>([]);
  const [progressEntries, setProgressEntries] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [queueItems, setQueueItems] = useState<WorkQueueItem[]>([]);
  const [draftCitationByTask, setDraftCitationByTask] = useState<
    Record<string, DraftCitationIntegrityView>
  >({});
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [opsFocus, setOpsFocus] = useState<OperationsFocus>("all");
  const [opsSort, setOpsSort] = useState<OperationsSort>("priority");

  const [panelTab, setPanelTab] = useState<"overview" | "case" | "tasks" | "timeline" | "cognition">("overview");
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<MatterSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [caseFocusContext, setCaseFocusContext] = useState<CaseFocusContext | null>(null);
  const [caseActionBusy, setCaseActionBusy] = useState(false);
  const [caseActionMsg, setCaseActionMsg] = useState<string | null>(null);
  const [caseDraftVariant, setCaseDraftVariant] = useState<CaseDraftVariant>("standard");
  const [caseDraftNote, setCaseDraftNote] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newMatterId, setNewMatterId] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [cognitionTaskId, setCognitionTaskId] = useState<string | null>(null);
  const [cognitionLoading, setCognitionLoading] = useState(false);
  const [cognitionError, setCognitionError] = useState<string | null>(null);
  const [cognitionReasoningMarkdown, setCognitionReasoningMarkdown] = useState<string | null>(null);
  const [cognitionMemorySources, setCognitionMemorySources] = useState<MemorySourceLayer[]>([]);
  const [cognitionBoardLoading, setCognitionBoardLoading] = useState(false);
  const [cognitionBoardError, setCognitionBoardError] = useState<string | null>(null);
  const [cognitionBoard, setCognitionBoard] = useState<MatterCognitionBoard | null>(null);
  const [cognitionActionBusy, setCognitionActionBusy] = useState<string | null>(null);
  const [cognitionActionMsg, setCognitionActionMsg] = useState<string | null>(null);
  const [crossExperimentRollup, setCrossExperimentRollup] = useState<MatterCrossExperimentRollupItem[]>([]);
  const [adoptedSuggestions, setAdoptedSuggestions] = useState<AdoptedSuggestionRecord[]>([]);
  const [persistentAdoptions, setPersistentAdoptions] = useState<AdoptedSuggestionRecord[]>([]);
  const hasHandledRefreshRef = useRef(false);
  const coreIssuesRef = useRef<HTMLHeadingElement | null>(null);
  const riskNotesRef = useRef<HTMLHeadingElement | null>(null);
  const artifactsRef = useRef<HTMLHeadingElement | null>(null);
  const caseMdRef = useRef<HTMLHeadingElement | null>(null);

  const pendingDrafts = drafts.filter((draft) => draft.reviewStatus === "pending");
  const modifiedDrafts = drafts.filter((draft) => draft.reviewStatus === "modified");
  const approvedDrafts = drafts.filter((draft) => draft.reviewStatus === "approved");
  const elevatedApprovals = approvalRequests.filter(
    (item) => item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high"),
  );
  const cognitionDefaultTaskId =
    pendingDrafts[0]?.taskId ??
    modifiedDrafts[0]?.taskId ??
    approvedDrafts[0]?.taskId ??
    drafts[0]?.taskId ??
    null;
  const cognitionBoardDrafts = useMemo(() => {
    const ordered = [...pendingDrafts, ...modifiedDrafts, ...approvedDrafts, ...drafts];
    const seen = new Set<string>();
    return ordered.filter((draft) => {
      if (seen.has(draft.taskId)) {
        return false;
      }
      seen.add(draft.taskId);
      return true;
    }).slice(0, 6);
  }, [approvedDrafts, drafts, modifiedDrafts, pendingDrafts]);

  const filteredQueueItems = useMemo(() => {
    const filtered = queueItems.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.kind === "need_lawyer_review" || item.kind === "need_partner_approval";
        case "modified":
          return item.kind === "need_lawyer_review" && (item.detail?.includes("修改") ?? false);
        case "delivery":
          return item.kind === "ready_to_render";
        case "highRisk":
          return item.priority === "critical" || item.priority === "high";
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      return byPriority !== 0 ? byPriority : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [opsFocus, opsSort, queueItems]);

  const filteredApprovalRequests = useMemo(() => {
    const filtered = approvalRequests.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.status === "pending";
        case "modified":
          return item.status === "needs_changes";
        case "delivery":
          return item.status === "approved";
        case "highRisk":
          return item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high");
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.reason.localeCompare(b.reason, "zh-CN");
      }
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (opsSort === "priority") {
        const byRisk = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        return byRisk !== 0 ? byRisk : b.requestedAt.localeCompare(a.requestedAt);
      }
      return b.requestedAt.localeCompare(a.requestedAt);
    });
  }, [approvalRequests, opsFocus, opsSort]);

  const filteredDrafts = useMemo(() => {
    const filtered = drafts.filter((draft) => {
      switch (opsFocus) {
        case "review":
          return draft.reviewStatus === "pending";
        case "modified":
          return draft.reviewStatus === "modified";
        case "delivery":
          return draft.reviewStatus === "approved";
        case "highRisk":
          return elevatedApprovals.some((item) => item.deliverableId === draft.taskId);
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      const statusOrder = { pending: 0, modified: 1, approved: 2, rejected: 3 };
      const byStatus = statusOrder[a.reviewStatus] - statusOrder[b.reviewStatus];
      return byStatus !== 0 ? byStatus : b.createdAt.localeCompare(a.createdAt);
    });
  }, [drafts, elevatedApprovals, opsFocus, opsSort]);

  const reviewTargetForFocus = useMemo(() => {
    switch (opsFocus) {
      case "review":
        return { statusFilter: "pending" as const, listMode: "pending" as const };
      case "modified":
        return { statusFilter: "modified" as const, listMode: "all" as const };
      case "delivery":
        return { statusFilter: "approved" as const, listMode: "all" as const };
      case "highRisk":
        return { statusFilter: "all" as const, listMode: "all" as const };
      default:
        return { statusFilter: "all" as const, listMode: "all" as const };
    }
  }, [opsFocus]);

  const recentMatterInteractions = useMemo(
    () => auditEvents.filter((event) => event.kind === "ui.matter_action").slice(-5).reverse(),
    [auditEvents],
  );

  const matterInteractionSummary = useMemo<MatterInteractionSummary>(() => {
    const interactions = auditEvents
      .filter((event) => event.kind === "ui.matter_action")
      .map((event) => ({ event, parsed: parseMatterInteractionEvent(event) }));
    const surfaceCounts = new Map<string, number>();
    const labelCounts = new Map<string, number>();
    let reviewOpenCount = 0;
    let memorySaveCount = 0;
    let caseWriteCount = 0;
    for (const item of interactions) {
      if (item.parsed.action === "open_review") {
        reviewOpenCount += 1;
      } else if (item.parsed.action === "save_upgrade_suggestion") {
        memorySaveCount += 1;
      } else if (item.parsed.action === "write_case_note") {
        caseWriteCount += 1;
      }
      if (item.parsed.surface) {
        surfaceCounts.set(item.parsed.surface, (surfaceCounts.get(item.parsed.surface) ?? 0) + 1);
      }
      if (item.parsed.label) {
        labelCounts.set(item.parsed.label, (labelCounts.get(item.parsed.label) ?? 0) + 1);
      }
    }
    const dominantSurface = Array.from(surfaceCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))[0];
    const dominantAction =
      reviewOpenCount >= memorySaveCount && reviewOpenCount >= caseWriteCount
        ? "review"
        : memorySaveCount >= caseWriteCount
          ? "memory"
          : "case";
    const dominantActionLabel =
      dominantAction === "review" ? "审核往返最频繁" : dominantAction === "memory" ? "认知沉淀最活跃" : "CASE 补档最频繁";
    const dominantActionHint =
      dominantAction === "review"
        ? "律师最近更多是在审核台和案件页之间来回切换，说明草稿把关仍是当前主工作面。"
        : dominantAction === "memory"
          ? "律师最近更常把高频经验沉淀进长期记忆，说明认知升级机制开始被实际使用。"
          : "律师最近更常把阻塞信息写回案件档案，说明 CASE 正在成为推进案件的实际操作面。";
    return {
      total: interactions.length,
      latestAt: interactions
        .map((item) => item.event.timestamp)
        .filter(Boolean)
        .toSorted((a, b) => a.localeCompare(b))
        .at(-1),
      reviewOpenCount,
      memorySaveCount,
      caseWriteCount,
      dominantSurface,
      dominantActionLabel,
      dominantActionHint,
      topLabels: Array.from(labelCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .filter((item) => item.count >= 2)
        .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
        .slice(0, 3),
    };
  }, [auditEvents]);

  const logMatterInteraction = useCallback(
    async (params: {
      action: "open_review" | "save_upgrade_suggestion" | "write_case_note";
      taskId?: string;
      surface: string;
      label: string;
      target?: "lawyer" | "assistant";
      variant?: CaseDraftVariant;
      section?: "core_issue" | "risk" | "artifact" | "task_goal";
    }) => {
      if (!selectedId) {
        return;
      }
      try {
        const r = await fetch(`${apiBase}/api/matters/interaction`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            matterId: selectedId,
            taskId: params.taskId,
            action: params.action,
            surface: params.surface,
            label: params.label,
            target: params.target,
            variant: params.variant,
            section: params.section,
          }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          event?: AuditEventRow;
        };
        if (r.ok && j.ok && j.event) {
          const event = j.event;
          setAuditEvents((prev) => [...prev, event].toSorted((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")));
        }
      } catch {
        /* interaction evidence is best effort */
      }
    },
    [apiBase, selectedId],
  );

  const blockingExplanations = useMemo(() => {
    const explanations: Array<{
      key: string;
      title: string;
      tone: "warn" | "info" | "neutral";
      detail: string;
      count: number;
      nextAction: string;
      actionLabel: string;
      actionTaskId?: string;
      actionTab?: "case" | "tasks";
      caseFocusContext?: CaseFocusContext;
    }> = [];

    const reviewBlockers = queueItems.filter(
      (item) => item.kind === "need_lawyer_review" || item.kind === "need_partner_approval",
    );
    if (reviewBlockers.length > 0) {
      explanations.push({
        key: "review",
        title: "审核链路阻塞",
        tone: "warn",
        detail:
          reviewBlockers[0]?.detail ??
          "当前至少有草稿还在等待律师或上级确认，交付动作不应继续推进。",
        count: reviewBlockers.length,
        nextAction: blockingNextAction(reviewBlockers[0]?.kind ?? "need_lawyer_review"),
        actionLabel: "去审核",
        actionTaskId: reviewBlockers[0]?.relatedTaskId,
      });
    }

    const evidenceBlockers = queueItems.filter(
      (item) =>
        item.kind === "need_evidence" || item.kind === "need_client_input" || item.kind === "need_conflict_check",
    );
    if (evidenceBlockers.length > 0) {
      explanations.push({
        key: "evidence",
        title: "材料与事实阻塞",
        tone: "info",
        detail:
          evidenceBlockers[0]?.detail ??
          "当前案件仍缺关键事实、证据或冲突检查信息，推理与交付可信度不足。",
        count: evidenceBlockers.length,
        nextAction: blockingNextAction(evidenceBlockers[0]?.kind ?? "need_evidence"),
        actionLabel: "去 CASE 档案",
        actionTab: "case",
        caseFocusContext: {
          title: "材料与事实阻塞",
          hint: "建议先在 CASE 档案里补充事实缺口、证据线索或客户待答问题。",
          query: "证据",
          section: "risk-notes",
        },
      });
    }

    const strategyBlockers = queueItems.filter((item) => item.kind === "blocked_by_missing_strategy");
    if (strategyBlockers.length > 0) {
      explanations.push({
        key: "strategy",
        title: "策略尚未定型",
        tone: "neutral",
        detail:
          strategyBlockers[0]?.detail ??
          "案件还没有沉淀出稳定的核心争点和任务目标，后续执行会反复返工。",
        count: strategyBlockers.length,
        nextAction: blockingNextAction(strategyBlockers[0]?.kind ?? "blocked_by_missing_strategy"),
        actionLabel: "去 CASE 档案",
        actionTab: "case",
        caseFocusContext: {
          title: "策略尚未定型",
          hint: "建议先在 CASE 或 MATTER_STRATEGY 中补齐核心争点、目标和底线。",
          query: "策略",
          section: "core-issues",
        },
      });
    }

    const renderReady = queueItems.filter((item) => item.kind === "ready_to_render");
    if (renderReady.length > 0) {
      explanations.push({
        key: "delivery",
        title: "交付动作未完成",
        tone: "info",
        detail:
          renderReady[0]?.detail ??
          "已有审核通过的草稿，但最终渲染和交付动作尚未执行。",
        count: renderReady.length,
        nextAction: blockingNextAction(renderReady[0]?.kind ?? "ready_to_render"),
        actionLabel: "去审核",
        actionTaskId: renderReady[0]?.relatedTaskId,
      });
    }

    return explanations.slice(0, 4);
  }, [queueItems]);

  const convergenceSuggestions = useMemo<MatterConvergenceSuggestion[]>(() => {
    const suggestions: MatterConvergenceSuggestion[] = [];

    if (matterInteractionSummary.reviewOpenCount >= 3) {
      const targetDraft = pendingDrafts[0] ?? modifiedDrafts[0] ?? approvedDrafts[0] ?? drafts[0];
      suggestions.push({
        key: "review-loop",
        title: "审核入口仍是主工作面",
        detail:
          "当前案件多次从驾驶舱跳去审核，说明律师还在围绕草稿把关来回切换。可以继续把关键审核决策前置到案件概览。",
        actionLabel: targetDraft ? "打开当前审核焦点" : "等待草稿",
        tone: "warn",
        target: targetDraft
          ? {
              type: "review",
              taskId: targetDraft.taskId,
              sourceSurface: "behavior-summary",
              sourceLabel: "审核入口仍是主工作面",
              statusFilter: targetDraft.reviewStatus,
              listMode: targetDraft.reviewStatus === "pending" ? "pending" : "all",
            }
          : { type: "none" },
      });
    }

    if (matterInteractionSummary.caseWriteCount >= 2) {
      const blockerContext =
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ?? caseFocusContext ?? undefined;
      suggestions.push({
        key: "case-loop",
        title: "CASE 已成为推进主入口",
        detail:
          "律师反复把阻塞信息写回案件档案，说明当前更需要结构化案件记录，而不只是列表式提醒。优先把争点、风险和证据补齐会更高效。",
        actionLabel: "回到 CASE 焦点",
        tone: "info",
        target: { type: "case", context: blockerContext },
      });
    }

    if (matterInteractionSummary.memorySaveCount >= 2) {
      suggestions.push({
        key: "memory-loop",
        title: "高频经验值得前置沉淀",
        detail:
          "当前案件已经开始重复采纳认知升级建议，说明有一部分经验正在从单案技巧变成稳定规则，适合继续在认知页审视并提升为长期记忆。",
        actionLabel: "查看认知升级线索",
        tone: "success",
        target: { type: "cognition" },
      });
    }

    if (
      suggestions.length === 0 &&
      matterInteractionSummary.total > 0 &&
      matterInteractionSummary.dominantSurface &&
      matterInteractionSummary.dominantSurface.count >= 2
    ) {
      suggestions.push({
        key: "observe-pattern",
        title: "继续观察当前操作重心",
        detail: `当前最常进入的入口是 ${matterInteractionSurfaceLabel(
          matterInteractionSummary.dominantSurface.label,
        )}，建议继续积累 2-3 个案件样本后再决定是否做更激进的交互收敛。`,
        actionLabel: "暂无动作",
        tone: "neutral",
        target: { type: "none" },
      });
    }

    return suggestions.slice(0, 3);
  }, [
    approvedDrafts,
    blockingExplanations,
    caseFocusContext,
    drafts,
    matterInteractionSummary,
    modifiedDrafts,
    pendingDrafts,
  ]);

  const productAdaptationSuggestions = useMemo<MatterProductAdaptationSuggestion[]>(() => {
    const suggestions: MatterProductAdaptationSuggestion[] = [];

    if (matterInteractionSummary.reviewOpenCount >= 3) {
      const targetDraft = pendingDrafts[0] ?? modifiedDrafts[0] ?? approvedDrafts[0] ?? drafts[0];
      suggestions.push({
        key: "adapt-review-surface",
        title: "把审核决策前置到案件概览",
        detail:
          "当前案件多次从驾驶舱跳去审核，说明概览页还缺少足够的审核上下文。下一版应把审核理由、修改标签和引用状态更早暴露出来。",
        actionLabel: targetDraft ? "查看当前审核焦点" : "等待草稿",
        tone: "warn",
        target: targetDraft
          ? {
              type: "review",
              taskId: targetDraft.taskId,
              sourceSurface: "product-adaptation",
              sourceLabel: "把审核决策前置到案件概览",
              statusFilter: targetDraft.reviewStatus,
              listMode: targetDraft.reviewStatus === "pending" ? "pending" : "all",
            }
          : { type: "none" },
      });
    }

    if (
      matterInteractionSummary.caseWriteCount >= 2 ||
      matterInteractionSummary.dominantSurface?.label === "blocked-by" ||
      matterInteractionSummary.dominantSurface?.label === "case-focus"
    ) {
      const blockerContext =
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ?? caseFocusContext ?? undefined;
      suggestions.push({
        key: "adapt-case-form",
        title: "为 CASE 补录增加结构化表单",
        detail:
          "律师反复回到 CASE 补档，说明自由文本入口不够顺手。下一版应把事实缺口、风险确认、策略目标拆成更显式的结构化输入，而不是只靠文本写回。",
        actionLabel: "查看当前 CASE 焦点",
        tone: "info",
        target: { type: "case", context: blockerContext },
      });
    }

    if (matterInteractionSummary.memorySaveCount >= 2) {
      suggestions.push({
        key: "adapt-memory-fastlane",
        title: "把认知升级做成快捷采纳通道",
        detail:
          "当前案件已经多次把建议写入长期记忆，说明认知沉淀不是偶发动作。下一版适合把高频升级建议做成更靠前的快捷采纳区，而不是藏在认知深层。",
        actionLabel: "查看认知页",
        tone: "success",
        target: { type: "cognition" },
      });
    }

    if (
      suggestions.length === 0 &&
      matterInteractionSummary.total > 0 &&
      matterInteractionSummary.dominantSurface &&
      matterInteractionSummary.dominantSurface.count >= 3
    ) {
      suggestions.push({
        key: "adapt-default-focus",
        title: "默认视图可能需要重新排序",
        detail: `当前最常进入的入口是 ${matterInteractionSurfaceLabel(
          matterInteractionSummary.dominantSurface.label,
        )}。如果这个模式持续出现在更多案件，下一版可以考虑让相关区域更早出现或默认展开。`,
        actionLabel: "继续观察",
        tone: "neutral",
        target: { type: "none" },
      });
    }

    return suggestions.slice(0, 3);
  }, [
    approvedDrafts,
    blockingExplanations,
    caseFocusContext,
    drafts,
    matterInteractionSummary,
    modifiedDrafts,
    pendingDrafts,
  ]);

  const productExperimentChecklist = useMemo<MatterProductExperimentItem[]>(() => {
    const items: MatterProductExperimentItem[] = [];

    for (const suggestion of productAdaptationSuggestions) {
      if (suggestion.key === "adapt-review-surface") {
        items.push({
          key: "exp-review-context",
          title: "实验：把审核上下文前置到概览",
          hypothesis: "如果在概览页提前暴露审核理由、引用状态和修改标签，律师进入审核台的往返次数会下降。",
          validation: "观察后续同类案件里“进入审核”次数是否下降，以及是否减少从概览跳审核后的立即返回。",
          signal: `当前案件已出现 ${matterInteractionSummary.reviewOpenCount} 次进入审核动作。`,
          priority: "high",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-case-form") {
        items.push({
          key: "exp-case-structured-form",
          title: "实验：把 CASE 补录改成结构化录入",
          hypothesis: "如果把事实缺口、风险确认、策略目标拆成结构化字段，律师反复回 CASE 补文本的次数会下降。",
          validation: "观察后续案件里“补 CASE”次数是否下降，并检查是否更少出现同主题重复写回。",
          signal: `当前案件已出现 ${matterInteractionSummary.caseWriteCount} 次 CASE 写回动作。`,
          priority: "high",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-memory-fastlane") {
        items.push({
          key: "exp-memory-fastlane",
          title: "实验：把认知升级做成快捷采纳区",
          hypothesis: "如果高频升级建议更早出现在驾驶舱里，律师会更愿意及时沉淀长期记忆，而不是等到认知深层再操作。",
          validation: "观察后续案件里认知建议采纳是否更早发生，且是否减少同一建议在单案内的重复检视。",
          signal: `当前案件已出现 ${matterInteractionSummary.memorySaveCount} 次长期记忆写入动作。`,
          priority: "medium",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-default-focus") {
        items.push({
          key: "exp-default-focus",
          title: "实验：调整默认展开与默认聚焦顺序",
          hypothesis: "如果默认把高频入口更早展示，律师会减少为了找到同一入口而反复切换页面。",
          validation: "观察更多案件里 dominant surface 是否稳定重复，再决定是否调整默认视图顺序。",
          signal: suggestion.detail,
          priority: "low",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
      }
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return items.toSorted((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]).slice(0, 4);
  }, [matterInteractionSummary.caseWriteCount, matterInteractionSummary.memorySaveCount, matterInteractionSummary.reviewOpenCount, productAdaptationSuggestions]);

  const crossMatterExperimentBoard = useMemo(() => {
    return crossExperimentRollup.map((item) => {
      const localSuggestion =
        productAdaptationSuggestions.find((suggestion) => suggestion.key === item.key) ??
        convergenceSuggestions.find((suggestion) => suggestion.key === item.key);
      return {
        ...item,
        includesCurrentMatter: Boolean(selectedId && item.exampleMatterIds.includes(selectedId)),
        localSuggestion,
      };
    });
  }, [convergenceSuggestions, crossExperimentRollup, productAdaptationSuggestions, selectedId]);

  const roadmapCandidates = useMemo<MatterRoadmapCandidate[]>(() => {
    return crossMatterExperimentBoard
      .map((item) => {
        const baseScore = item.matterCount * 10 + item.totalEvents * 2 + (item.includesCurrentMatter ? 3 : 0);
        const bias =
          item.key === "adapt-review-surface"
            ? 5
            : item.key === "adapt-case-form"
              ? 4
              : item.key === "adapt-memory-fastlane"
                ? 3
                : 1;
        const score = baseScore + bias;
        const urgency: MatterRoadmapCandidate["urgency"] = score >= 28 ? "now" : score >= 16 ? "next" : "later";
        const readiness: MatterRoadmapCandidate["readiness"] =
          item.matterCount >= 3 || item.totalEvents >= 8 ? "validated" : score >= 16 ? "emerging" : "watching";
        const rationale =
          item.key === "adapt-review-surface"
            ? "多个案件都在重复把审核上下文留到审核台，说明概览层的信息前置价值最高。"
            : item.key === "adapt-case-form"
              ? "多个案件都在反复补 CASE 文本，说明结构化补录已经接近共性需求。"
              : item.key === "adapt-memory-fastlane"
                ? "多个案件都在持续沉淀长期记忆，说明认知升级正在从偶发动作走向常规流程。"
                : "同一入口在多个案件中持续高频出现，说明默认展示顺序可能已经需要调整。";
        const owner =
          item.key === "adapt-review-surface"
            ? "案件概览 / 审核流"
            : item.key === "adapt-case-form"
              ? "CASE 档案层"
              : item.key === "adapt-memory-fastlane"
                ? "认知面板"
                : "工作台框架";
        const benefit =
          item.key === "adapt-review-surface"
            ? "减少律师在概览与审核台之间的来回切换，把关键待审信号前置到主工作面。"
            : item.key === "adapt-case-form"
              ? "把反复补录的案件说明转成结构化输入，降低自由文本维护成本。"
              : item.key === "adapt-memory-fastlane"
                ? "把高频经验沉淀动作缩短成一跳，提升规则复用效率。"
                : "让高频动作更贴近默认入口，降低律师寻找下一步的认知负担。";
        const risk =
          item.key === "adapt-review-surface"
            ? "如果前置内容过多，概览可能重新变重，影响快速扫读。"
            : item.key === "adapt-case-form"
              ? "表单字段一旦设计过早，容易限制律师的表达弹性。"
              : item.key === "adapt-memory-fastlane"
                ? "过快沉淀可能把尚未稳定的经验写入长期记忆。"
                : "入口顺序调整如果没有伴随真实收益，容易制造新的导航习惯成本。";
        return {
          key: item.key,
          title: item.title,
          score,
          rationale,
          urgency,
          readiness,
          owner,
          benefit,
          risk,
          matterCount: item.matterCount,
          totalEvents: item.totalEvents,
          latestAt: item.latestAt,
          localSuggestion: item.localSuggestion,
        };
      })
      .toSorted((a, b) => (b.score - a.score) || a.title.localeCompare(b.title, "zh-CN"))
      .slice(0, 5);
  }, [crossMatterExperimentBoard]);

  const roadmapPressureSummary = useMemo(() => {
    const nowCount = roadmapCandidates.filter((item) => item.urgency === "now").length;
    const validatedCount = roadmapCandidates.filter((item) => item.readiness === "validated").length;
    const topCandidate = roadmapCandidates[0] ?? null;
    return {
      candidateCount: roadmapCandidates.length,
      nowCount,
      validatedCount,
      topCandidate,
    };
  }, [roadmapCandidates]);

  const openReviewFromMatter = useCallback(
    (taskId: string, overrides?: {
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
      sourceSurface?: string;
      sourceLabel?: string;
    }) => {
      if (!onOpenReview) {
        return;
      }
      void logMatterInteraction({
        action: "open_review",
        taskId,
        surface: overrides?.sourceSurface ?? "overview",
        label: overrides?.sourceLabel ?? "进入审核台",
      });
      onOpenReview({
        taskId,
        matterId: overrides?.matterId ?? selectedId ?? undefined,
        statusFilter: overrides?.statusFilter ?? reviewTargetForFocus.statusFilter,
        listMode: overrides?.listMode ?? reviewTargetForFocus.listMode,
      });
    },
    [logMatterInteraction, onOpenReview, reviewTargetForFocus, selectedId],
  );

  const handleBlockingAction = useCallback(
    (item: { actionTaskId?: string; actionTab?: "case" | "tasks"; caseFocusContext?: CaseFocusContext }) => {
      if (item.actionTaskId) {
        openReviewFromMatter(item.actionTaskId, {
          sourceSurface: "blocked-by",
          sourceLabel: item.caseFocusContext?.title ?? "Blocked By",
        });
        return;
      }
      if (item.actionTab) {
        setPanelTab(item.actionTab);
        if (item.actionTab === "case") {
          setCaseFocusContext(item.caseFocusContext ?? null);
          setSearchQ(item.caseFocusContext?.query ?? "");
          setSearchHits([]);
        }
      }
    },
    [openReviewFromMatter],
  );

  const handleConvergenceSuggestion = useCallback(
    (item: { target: MatterRecommendationTarget }) => {
      if (item.target.type === "review") {
        openReviewFromMatter(item.target.taskId, {
          statusFilter: item.target.statusFilter,
          listMode: item.target.listMode,
          sourceSurface: item.target.sourceSurface,
          sourceLabel: item.target.sourceLabel,
        });
        return;
      }
      if (item.target.type === "case") {
        setPanelTab("case");
        setCaseFocusContext(item.target.context ?? null);
        setSearchQ(item.target.context?.query ?? "");
        setSearchHits([]);
        return;
      }
      if (item.target.type === "cognition") {
        setPanelTab("cognition");
      }
    },
    [openReviewFromMatter],
  );

  async function saveUpgradeSuggestion(
    target: "lawyer" | "assistant",
    item: { label: string; recommendation: string; count: number },
  ) {
    const currentDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;
    const sourceMatter = selectedId ? `来源案件 ${selectedId}` : "来源案件未知";
    const sourceDraft = currentDraft
      ? `观察草稿 ${currentDraft.title}（任务 ${currentDraft.taskId}）`
      : "观察草稿未知";
    const note = `${sourceMatter}；${sourceDraft}。认知升级建议：${item.label} 在当前案件关键草稿中命中 ${item.count} 次。${item.recommendation}`;
    const busyKey = `${target}:${item.label}`;
    setCognitionActionBusy(busyKey);
    setCognitionActionMsg(null);
    try {
      const endpoint =
        target === "lawyer" ? `${apiBase}/api/lawyer-profile/learning` : `${apiBase}/api/assistants/profile/learning`;
      const body =
        target === "lawyer"
          ? { note, source: "manual" }
          : { assistantId: assistantId ?? "default", note };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "写入失败");
      }
      setCognitionActionMsg(
        target === "lawyer" ? "已写入律师档案。后续案件将可复用该升级建议。" : "已写入当前助手档案。",
      );
      await logMatterInteraction({
        action: "save_upgrade_suggestion",
        taskId: currentDraft?.taskId ?? undefined,
        surface: "cognition",
        label: item.label,
        target,
      });
      setAdoptedSuggestions((prev) =>
        [
          {
            key: `${target}:${item.label}:${Date.now()}`,
            target,
            label: item.label,
            matterId: selectedId,
            taskId: currentDraft?.taskId ?? null,
            draftTitle: currentDraft?.title ?? null,
            savedAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 8),
      );
      void loadPersistentAdoptions();
    } catch (e) {
      setCognitionActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCognitionActionBusy(null);
    }
  }

  async function writeCaseFocusNote() {
    if (!selectedId || !caseFocusContext) {
      return;
    }
    setCaseActionBusy(true);
    setCaseActionMsg(null);
    try {
      const note = caseDraftNote.trim() || `${caseFocusContext.title}：${caseFocusContext.hint}`;
      const r = await fetch(`${apiBase}/api/matters/case-note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matterId: selectedId,
          section: sectionWriteTarget(caseFocusContext.section),
          note,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "写入案件档案失败");
      }
      await logMatterInteraction({
        action: "write_case_note",
        surface: "case-focus",
        label: caseFocusContext.title,
        variant: caseDraftVariant,
        section: sectionWriteTarget(caseFocusContext.section),
      });
      setCaseActionMsg("已写入案件档案。");
      await loadDetail(selectedId);
    } catch (e) {
      setCaseActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCaseActionBusy(false);
    }
  }

  const reviewSummaryCards: Array<{
    key: string;
    title: string;
    count: number;
    tone: "warn" | "info" | "success" | "neutral";
    hint: string;
    actionLabel: string;
    actionTaskId?: string;
    statusFilter: ArtifactDraft["reviewStatus"] | "all";
    listMode: "pending" | "all";
  }> = [
    {
      key: "pending-review",
      title: "待审核草稿",
      count: pendingDrafts.length,
      tone: "warn",
      hint: pendingDrafts[0]?.title ?? "当前没有待审核草稿",
      actionLabel: pendingDrafts.length > 0 ? "去处理" : "已清空",
      actionTaskId: pendingDrafts[0]?.taskId,
      statusFilter: "pending",
      listMode: "pending",
    },
    {
      key: "needs-changes",
      title: "需修改返回",
      count: modifiedDrafts.length,
      tone: "info",
      hint: modifiedDrafts[0]?.title ?? "当前没有需修改草稿",
      actionLabel: modifiedDrafts.length > 0 ? "去复核" : "无待办",
      actionTaskId: modifiedDrafts[0]?.taskId,
      statusFilter: "modified",
      listMode: "all",
    },
    {
      key: "ready-to-render",
      title: "可渲染交付",
      count: approvedDrafts.length,
      tone: "success",
      hint: approvedDrafts[0]?.title ?? "当前没有可直接交付草稿",
      actionLabel: approvedDrafts.length > 0 ? "去交付" : "暂无",
      actionTaskId: approvedDrafts[0]?.taskId,
      statusFilter: "approved",
      listMode: "all",
    },
    {
      key: "pending-approval",
      title: "高风险审批",
      count: elevatedApprovals.length,
      tone: "neutral",
      hint: elevatedApprovals[0]?.reason ?? "当前没有高风险审批项",
      actionLabel: elevatedApprovals.length > 0 ? "去查看" : "正常",
      actionTaskId: elevatedApprovals[0]?.deliverableId,
      statusFilter: "all",
      listMode: "all",
    },
  ];

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const r = await fetch(`${apiBase}/api/matters/overviews`);
      const j = (await r.json()) as { ok?: boolean; overviews?: MatterOverview[] };
      if (!j.ok || !Array.isArray(j.overviews)) {
        throw new Error("加载案件列表失败");
      }
      setOverviews(j.overviews);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (matterId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setSearchHits([]);
      setSearchQ("");
      try {
        const r = await fetch(
          `${apiBase}/api/matters/detail?matterId=${encodeURIComponent(matterId)}`,
        );
        const j = (await r.json()) as {
          ok?: boolean;
          error?: string;
          summary?: MatterSummary;
          overview?: MatterOverview;
          caseMemory?: string;
          caseMemoryTruncated?: boolean;
          coreIssues?: string[];
          riskNotes?: string[];
          progressEntries?: string[];
          artifacts?: string[];
          tasks?: TaskRecord[];
          drafts?: ArtifactDraft[];
          approvalRequests?: ApprovalRequest[];
          queueItems?: WorkQueueItem[];
          draftCitationIntegrity?: Record<string, DraftCitationIntegrityView>;
          auditEvents?: AuditEventRow[];
        };
        if (!r.ok || !j.ok) {
          throw new Error(j.error ?? "加载案件详情失败");
        }
        setSummary(j.summary ?? null);
        setOverview(j.overview ?? null);
        setCaseMemory(j.caseMemory ?? "");
        setCaseTruncated(Boolean(j.caseMemoryTruncated));
        setCoreIssues(j.coreIssues ?? []);
        setRiskNotes(j.riskNotes ?? []);
        setProgressEntries(j.progressEntries ?? []);
        setArtifacts(j.artifacts ?? []);
        setTasks(j.tasks ?? []);
        setDrafts(j.drafts ?? []);
        setApprovalRequests(j.approvalRequests ?? []);
        setQueueItems(j.queueItems ?? []);
        setDraftCitationByTask(
          j.draftCitationIntegrity && typeof j.draftCitationIntegrity === "object"
            ? j.draftCitationIntegrity
            : {},
        );
        setAuditEvents(j.auditEvents ?? []);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  async function loadPersistentAdoptions() {
    try {
      const params = new URLSearchParams();
      if (assistantId) {
        params.set("assistantId", assistantId);
      }
      const r = await fetch(`${apiBase}/api/memory/adoptions?${params.toString()}`);
      const j = (await r.json()) as { ok?: boolean; items?: PersistentAdoptionItem[] };
      if (!r.ok || !j.ok || !Array.isArray(j.items)) {
        return;
      }
      const items = j.items
        .map((item, index) => {
          const matterMatch = /来源案件\s+([^\s；。]+)/.exec(item.body);
          const taskMatch = /任务\s+([^)）]+)/.exec(item.body);
          const draftMatch = /观察草稿\s+(.+?)（任务/.exec(item.body);
          const labelMatch = /认知升级建议：(.+?)\s+在当前案件关键草稿中命中/.exec(item.body);
          return {
            key: `persist:${item.target}:${item.stamp}:${index}`,
            target: item.target,
            label: labelMatch?.[1]?.trim() ?? item.body.slice(0, 40),
            matterId: matterMatch?.[1]?.trim() ?? null,
            taskId: taskMatch?.[1]?.trim() ?? null,
            draftTitle: draftMatch?.[1]?.trim() ?? null,
            savedAt: item.stamp,
            rawBody: item.body,
          } satisfies AdoptedSuggestionRecord;
        })
      setPersistentAdoptions(items);
    } catch {
      setPersistentAdoptions([]);
    }
  }

  async function loadCrossExperimentRollup() {
    try {
      const r = await fetch(`${apiBase}/api/matters/interaction-rollup`);
      const j = (await r.json()) as {
        ok?: boolean;
        items?: MatterCrossExperimentRollupItem[];
      };
      if (!r.ok || !j.ok || !Array.isArray(j.items)) {
        return;
      }
      setCrossExperimentRollup(j.items);
    } catch {
      setCrossExperimentRollup([]);
    }
  }

  useEffect(() => {
    setCaseFocusContext(null);
  }, [selectedId]);

  useEffect(() => {
    setCaseDraftVariant("standard");
    setCaseDraftNote(caseFocusContext ? buildCaseFocusDraft(caseFocusContext, "standard") : "");
    setCaseActionMsg(null);
  }, [caseFocusContext]);

  useEffect(() => {
    void loadPersistentAdoptions();
  }, [apiBase, assistantId, selectedId]);

  useEffect(() => {
    void loadCrossExperimentRollup();
  }, [apiBase, refreshVersion]);

  useEffect(() => {
    if (panelTab !== "case" || !caseFocusContext?.section) {
      return;
    }
    const target =
      caseFocusContext.section === "core-issues"
        ? coreIssuesRef.current
        : caseFocusContext.section === "risk-notes"
          ? riskNotesRef.current
          : caseFocusContext.section === "artifacts"
            ? artifactsRef.current
            : caseMdRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [caseFocusContext, panelTab]);

  const adoptionHistoryInsight = useMemo<AdoptionHistoryInsight>(() => {
    const scoped = selectedId
      ? persistentAdoptions.filter((item) => item.matterId === selectedId)
      : persistentAdoptions;
    const relevantLabels = new Set(scoped.map((item) => item.label));
    const counts = new Map<string, { count: number; matterIds: Set<string>; latestSavedAt?: string }>();
    for (const item of persistentAdoptions) {
      if (selectedId && !relevantLabels.has(item.label)) {
        continue;
      }
      const current = counts.get(item.label) ?? { count: 0, matterIds: new Set<string>(), latestSavedAt: undefined };
      current.count += 1;
      if (item.matterId) {
        current.matterIds.add(item.matterId);
      }
      if (!current.latestSavedAt || item.savedAt > current.latestSavedAt) {
        current.latestSavedAt = item.savedAt;
      }
      counts.set(item.label, current);
    }
    return {
      total: scoped.length,
      lawyerCount: scoped.filter((item) => item.target === "lawyer").length,
      assistantCount: scoped.filter((item) => item.target === "assistant").length,
      crossMatterCount: new Set(scoped.map((item) => item.matterId).filter(Boolean)).size,
      latestSavedAt: scoped.map((item) => item.savedAt).toSorted().at(-1),
      repeatedLabels: Array.from(counts.entries())
        .map(([label, meta]) => ({
          label,
          count: meta.count,
          matterIds: Array.from(meta.matterIds).toSorted(),
          latestSavedAt: meta.latestSavedAt,
        }))
        .filter((item) => item.count >= 2)
        .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
        .slice(0, 5),
    };
  }, [persistentAdoptions, selectedId]);

  const visiblePersistentAdoptions = useMemo(
    () =>
      persistentAdoptions
        .filter((item) => !selectedId || item.matterId === selectedId)
        .toSorted((a, b) => b.savedAt.localeCompare(a.savedAt))
        .slice(0, 8),
    [persistentAdoptions, selectedId],
  );

  useEffect(() => {
    if (!hasHandledRefreshRef.current) {
      hasHandledRefreshRef.current = true;
      return;
    }
    void loadList();
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [refreshVersion, loadDetail, loadList, selectedId]);

  useEffect(() => {
    setCognitionTaskId(cognitionDefaultTaskId);
  }, [cognitionDefaultTaskId, selectedId]);

  const fetchDraftCognition = useCallback(
    async (taskId: string) => {
      const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(taskId)}`);
      const j = (await r.json()) as {
        ok?: boolean;
        reasoningMarkdown?: string | null;
        memorySources?: MemorySourceLayer[];
        error?: string;
      };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "加载认知面板失败");
      }
      return {
        reasoningMarkdown: typeof j.reasoningMarkdown === "string" ? j.reasoningMarkdown : null,
        memorySources: Array.isArray(j.memorySources) ? j.memorySources : [],
      };
    },
    [apiBase],
  );

  const loadCognitionDetail = useCallback(
    async (taskId: string) => {
      setCognitionLoading(true);
      setCognitionError(null);
      try {
        const detail = await fetchDraftCognition(taskId);
        setCognitionReasoningMarkdown(detail.reasoningMarkdown);
        setCognitionMemorySources(detail.memorySources);
      } catch (e) {
        setCognitionReasoningMarkdown(null);
        setCognitionMemorySources([]);
        setCognitionError(e instanceof Error ? e.message : String(e));
      } finally {
        setCognitionLoading(false);
      }
    },
    [fetchDraftCognition],
  );

  useEffect(() => {
    if (!cognitionTaskId) {
      setCognitionReasoningMarkdown(null);
      setCognitionMemorySources([]);
      setCognitionError(null);
      return;
    }
    void loadCognitionDetail(cognitionTaskId);
  }, [cognitionTaskId, loadCognitionDetail]);

  useEffect(() => {
    let cancelled = false;

    async function loadCognitionBoard() {
      if (cognitionBoardDrafts.length === 0) {
        setCognitionBoard(null);
        setCognitionBoardError(null);
        return;
      }
      setCognitionBoardLoading(true);
      setCognitionBoardError(null);
      try {
        const entries = await Promise.all(
          cognitionBoardDrafts.map(async (draft) => ({
            draft,
            ...(await fetchDraftCognition(draft.taskId)),
          })),
        );
        if (cancelled) {
          return;
        }
        const layerCounts = new Map<string, { count: number; injected: boolean }>();
        for (const entry of entries) {
          const seenLabels = new Set<string>();
          for (const layer of entry.memorySources) {
            if (seenLabels.has(layer.label)) {
              continue;
            }
            seenLabels.add(layer.label);
            const current = layerCounts.get(layer.label) ?? { count: 0, injected: false };
            current.count += 1;
            current.injected = current.injected || Boolean(layer.inAgentSystemPrompt);
            layerCounts.set(layer.label, current);
          }
        }
        const board: MatterCognitionBoard = {
          observedDraftCount: entries.length,
          reasoningDraftCount: entries.filter((entry) => Boolean(entry.reasoningMarkdown?.trim())).length,
          missingReasoningCount: entries.filter((entry) => !entry.reasoningMarkdown?.trim()).length,
          missingCitationCount: entries.filter((entry) => {
            const cit = draftCitationByTask[entry.draft.taskId];
            return !cit || !cit.checked || !cit.ok;
          }).length,
          uniqueMemoryLayerCount: layerCounts.size,
          injectedMemoryLayerCount: Array.from(layerCounts.values()).filter((entry) => entry.injected).length,
          candidateMemoryLayerCount: Array.from(layerCounts.values()).filter((entry) => !entry.injected).length,
          missingMemoryLayerCount: Array.from(entries.flatMap((entry) => entry.memorySources)).filter(
            (layer) => !layer.exists,
          ).length,
          uncoveredFrequentLayerCount: Array.from(layerCounts.values()).filter(
            (entry) => !entry.injected && entry.count >= 2,
          ).length,
          newestDraftAt: entries.map((entry) => entry.draft.createdAt).toSorted().at(-1),
          oldestDraftAt: entries.map((entry) => entry.draft.createdAt).toSorted().at(0),
          topMemoryLayers: Array.from(layerCounts.entries())
            .map(([label, meta]) => ({ label, ...meta }))
            .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
            .slice(0, 6),
          memoryCategories: [
            {
              key: "injected",
              title: "已注入核心记忆",
              count: Array.from(layerCounts.values()).filter((entry) => entry.injected).length,
              hint: "这些层已经进入 system prompt，直接参与当前推理。",
            },
            {
              key: "candidate",
              title: "检索候选真相源",
              count: Array.from(layerCounts.values()).filter((entry) => !entry.injected).length,
              hint: "这些层更多通过检索或辅助读取进入工作流，还没成为核心常驻记忆。",
            },
            {
              key: "missing",
              title: "缺失但应存在",
              count: Array.from(entries.flatMap((entry) => entry.memorySources)).filter((layer) => !layer.exists)
                .length,
              hint: "这些层被工作流期待，但对应文件当前缺失，可能导致推理不稳。",
            },
          ],
          missingMemoryLayers: (() => {
            const missingCounts = new Map<string, number>();
            for (const entry of entries) {
              for (const layer of entry.memorySources) {
                if (layer.exists) {
                  continue;
                }
                missingCounts.set(layer.label, (missingCounts.get(layer.label) ?? 0) + 1);
              }
            }
            return Array.from(missingCounts.entries())
              .map(([label, count]) => ({ label, count }))
              .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
              .slice(0, 6);
          })(),
          upgradeSuggestions: Array.from(layerCounts.entries())
            .map(([label, meta]) => ({ label, count: meta.count, injected: meta.injected }))
            .filter((entry) => !entry.injected && entry.count >= 2)
            .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
            .slice(0, 5)
            .map((entry) => ({
              label: entry.label,
              count: entry.count,
              recommendation: memoryUpgradeRecommendation(entry.label),
            })),
          draftCoverage: entries.map((entry) => ({
            taskId: entry.draft.taskId,
            title: entry.draft.title,
            status: entry.draft.reviewStatus,
            hasReasoning: Boolean(entry.reasoningMarkdown?.trim()),
            memoryLayerCount: entry.memorySources.length,
            citationState: (() => {
              const cit = draftCitationByTask[entry.draft.taskId];
              if (!cit || !cit.checked) {
                return "missing" as const;
              }
              return cit.ok ? ("ok" as const) : ("warn" as const);
            })(),
            createdAt: entry.draft.createdAt,
          })),
        };
        setCognitionBoard(board);
      } catch (e) {
        if (!cancelled) {
          setCognitionBoard(null);
          setCognitionBoardError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setCognitionBoardLoading(false);
        }
      }
    }

    void loadCognitionBoard();
    return () => {
      cancelled = true;
    };
  }, [cognitionBoardDrafts, draftCitationByTask, fetchDraftCognition]);

  const cognitionDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;

  const runSearch = useCallback(async () => {
    if (!selectedId || !searchQ.trim()) {
      return;
    }
    setSearchBusy(true);
    try {
      const r = await fetch(
        `${apiBase}/api/matters/search?matterId=${encodeURIComponent(selectedId)}&q=${encodeURIComponent(searchQ.trim())}`,
      );
      const j = (await r.json()) as { ok?: boolean; hits?: MatterSearchHit[] };
      if (j.ok && Array.isArray(j.hits)) {
        setSearchHits(j.hits);
      }
    } finally {
      setSearchBusy(false);
    }
  }, [apiBase, selectedId, searchQ]);

  const submitCreate = async () => {
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const r = await fetch(`${apiBase}/api/matters/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matterId: newMatterId.trim() }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; matterId?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "创建失败");
      }
      setShowCreate(false);
      setNewMatterId("");
      await loadList();
      if (j.matterId) {
        setSelectedId(j.matterId);
        setPanelTab("overview");
      }
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <>
      {showCreate && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="新建案件">
          <div className="lm-wizard lm-modal-matter-create">
            <h2>新建案件</h2>
            <p className="lm-meta">
              案件 ID 须为字母或数字开头，2–128 字符，仅含字母、数字、英文点、下划线、连字符（与引擎{" "}
              <code>matter_id</code> 一致）。
            </p>
            <label className="lm-field">
              <span>matterId</span>
              <input
                type="text"
                value={newMatterId}
                onChange={(e) => setNewMatterId(e.target.value)}
                placeholder="例如 matter-2026-001"
                autoComplete="off"
              />
            </label>
            {createErr && <div className="lm-error">{createErr}</div>}
            <div className="lm-wizard-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                disabled={createBusy}
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="lm-btn"
                disabled={createBusy || !newMatterId.trim()}
                onClick={() => void submitCreate()}
              >
                {createBusy ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="lm-workbench lm-matter-workbench">
      <div className="lm-workbench-list">
        <div className="lm-workbench-list-header">
          <h2>案件</h2>
          <div className="lm-workbench-list-actions">
            <button
              type="button"
              className="lm-btn lm-btn-small"
              onClick={() => {
                setCreateErr(null);
                setNewMatterId("");
                setShowCreate(true);
              }}
            >
              新建案件
            </button>
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadList()}>
              刷新
            </button>
          </div>
        </div>
        {loadingList && <div className="lm-meta">加载中…</div>}
        {listError && <div className="lm-error">{listError}</div>}
        {!loadingList && overviews.length === 0 && (
          <div className="lm-meta lm-workbench-empty">
            暂无案件。在对话中完成带 matterId 的任务后，将在此聚合显示。
          </div>
        )}
        <ul className="lm-workbench-matter-list">
          {overviews.map((o) => (
            <li key={o.matterId}>
              <button
                type="button"
                className={`lm-matter-row ${selectedId === o.matterId ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(o.matterId);
                  setPanelTab("overview");
                }}
              >
                <span className="lm-matter-id">{o.matterId}</span>
                <span className="lm-matter-meta">
                  待办 {o.openTaskCount} · 已交付 {o.renderedTaskCount}
                  {o.topRisk ? ` · ${o.topRisk.slice(0, 42)}…` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lm-workbench-main">
        {!selectedId && <div className="lm-meta lm-workbench-placeholder">选择左侧案件查看档案与进度</div>}
        {selectedId && detailLoading && <div className="lm-meta">加载案件详情…</div>}
        {selectedId && detailError && <div className="lm-error">{detailError}</div>}
        {selectedId && !detailLoading && !detailError && summary && (
          <>
            <div className="lm-workbench-toolbar">
              <div className="lm-workbench-title-block">
                <h2>{selectedId}</h2>
                <p className="lm-matter-headline">{summary.headline}</p>
                <p className="lm-meta">{summary.statusLine}</p>
              </div>
              {onUseInChat && (
                <button type="button" className="lm-btn lm-btn-secondary" onClick={() => onUseInChat(selectedId)}>
                  在对话中关联本案
                </button>
              )}
            </div>

            <div className="lm-tabs lm-workbench-tabs">
              <button
                type="button"
                className={`lm-tab ${panelTab === "overview" ? "active" : ""}`}
                onClick={() => setPanelTab("overview")}
              >
                概览
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "case" ? "active" : ""}`}
                onClick={() => setPanelTab("case")}
              >
                CASE 档案
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "tasks" ? "active" : ""}`}
                onClick={() => setPanelTab("tasks")}
              >
                任务与草稿
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "timeline" ? "active" : ""}`}
                onClick={() => setPanelTab("timeline")}
              >
                审计
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "cognition" ? "active" : ""}`}
                onClick={() => setPanelTab("cognition")}
              >
                认知
              </button>
            </div>

            {panelTab === "overview" && (
              <div className="lm-workbench-panel">
                <section className="lm-matter-cockpit-summary">
                  {reviewSummaryCards.map((card) => (
                    <div key={card.key} className={`lm-matter-summary-card lm-matter-summary-card-${card.tone}`}>
                      <div className="lm-matter-summary-top">
                        <span className="lm-matter-summary-title">{card.title}</span>
                        <span className="lm-matter-summary-count">{card.count}</span>
                      </div>
                      <div className="lm-matter-summary-hint">{card.hint}</div>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={!onOpenReview || !card.actionTaskId}
                        onClick={() => {
                          if (card.actionTaskId) {
                            openReviewFromMatter(card.actionTaskId, {
                              statusFilter: card.statusFilter,
                              listMode: card.listMode,
                              sourceSurface: "overview-summary",
                              sourceLabel: card.title,
                            });
                          }
                        }}
                      >
                        {card.actionLabel}
                      </button>
                    </div>
                  ))}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-ops-focus-card">
                  <div className="lm-matter-ops-focus-head">
                    <div>
                      <h3>当前处理视角</h3>
                      <p className="lm-meta">按你当前关注的审核态筛选案件操作面板，并切换排序优先级。</p>
                    </div>
                    <div className="lm-matter-ops-focus-controls">
                      <label className="lm-field lm-matter-ops-field">
                        <span>只看</span>
                        <select
                          value={opsFocus}
                          onChange={(e) => setOpsFocus(e.target.value as OperationsFocus)}
                        >
                          <option value="all">全部</option>
                          <option value="review">待审核 / 待审批</option>
                          <option value="modified">需修改返回</option>
                          <option value="delivery">可交付 / 可渲染</option>
                          <option value="highRisk">高风险优先</option>
                        </select>
                      </label>
                      <label className="lm-field lm-matter-ops-field">
                        <span>排序</span>
                        <select
                          value={opsSort}
                          onChange={(e) => setOpsSort(e.target.value as OperationsSort)}
                        >
                          <option value="priority">优先级优先</option>
                          <option value="recent">最近更新</option>
                          <option value="title">按标题</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </section>

                <section className="lm-matter-cockpit-card lm-matter-blocking-card">
                  <h3>Blocked By</h3>
                  {blockingExplanations.length === 0 ? (
                    <p className="lm-meta">当前没有显式阻塞项，案件可继续推进。</p>
                  ) : (
                    <div className="lm-matter-blocking-grid">
                      {blockingExplanations.map((item) => (
                        <div key={item.key} className={`lm-matter-summary-card lm-matter-summary-card-${item.tone}`}>
                          <div className="lm-matter-summary-top">
                            <span className="lm-matter-summary-title">{item.title}</span>
                            <span className="lm-matter-summary-count">{item.count}</span>
                          </div>
                          <div className="lm-matter-summary-hint">{item.detail}</div>
                          <div className="lm-matter-summary-reco">建议下一步：{item.nextAction}</div>
                          <button
                            type="button"
                            className="lm-btn lm-btn-secondary lm-btn-small"
                            onClick={() => handleBlockingAction(item)}
                          >
                            {item.actionLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {queueItems.length > 0 ? (
                    <ul className="lm-matter-ops-list lm-matter-blocking-list">
                      {queueItems.slice(0, 4).map((item) => (
                        <li key={item.queueItemId}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <span className={`lm-matter-pill lm-matter-pill-priority-${item.priority}`}>
                              {priorityLabel(item.priority)}
                            </span>
                          </div>
                          <div className="lm-matter-ops-meta">
                            {blockingReasonLabel(item.kind)}
                            {item.detail ? ` · ${item.detail}` : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-behavior-card">
                  <h3>律师行为摘要</h3>
                  {matterInteractionSummary.total === 0 ? (
                    <p className="lm-meta">当前案件还没有足够的人工动作记录，暂时无法判断主要工作重心。</p>
                  ) : (
                    <>
                      <div className="lm-matter-cognition-board lm-matter-adoption-board">
                        <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                          <div className="lm-matter-summary-top">
                            <span className="lm-matter-summary-title">总动作</span>
                            <span className="lm-matter-summary-count">{matterInteractionSummary.total}</span>
                          </div>
                          <div className="lm-matter-summary-hint">
                            当前案件已记录的关键律师动作总数。
                          </div>
                        </div>
                        <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                          <div className="lm-matter-summary-top">
                            <span className="lm-matter-summary-title">进入审核</span>
                            <span className="lm-matter-summary-count">{matterInteractionSummary.reviewOpenCount}</span>
                          </div>
                          <div className="lm-matter-summary-hint">
                            律师从案件页切去审核台的次数，能反映草稿把关压力。
                          </div>
                        </div>
                        <div className="lm-matter-summary-card lm-matter-summary-card-info">
                          <div className="lm-matter-summary-top">
                            <span className="lm-matter-summary-title">补 CASE</span>
                            <span className="lm-matter-summary-count">{matterInteractionSummary.caseWriteCount}</span>
                          </div>
                          <div className="lm-matter-summary-hint">
                            把阻塞或判断写回案件档案的次数，反映档案修补活跃度。
                          </div>
                        </div>
                        <div className="lm-matter-summary-card lm-matter-summary-card-success">
                          <div className="lm-matter-summary-top">
                            <span className="lm-matter-summary-title">沉淀记忆</span>
                            <span className="lm-matter-summary-count">{matterInteractionSummary.memorySaveCount}</span>
                          </div>
                          <div className="lm-matter-summary-hint">
                            认知升级建议被采纳写入长期记忆的次数。
                          </div>
                        </div>
                      </div>
                      <div className="lm-matter-ops-meta">
                        当前主重心：{matterInteractionSummary.dominantActionLabel}。
                        {matterInteractionSummary.latestAt
                          ? ` 最近一次动作发生在 ${formatShortDateTime(matterInteractionSummary.latestAt)}。`
                          : ""}
                        {matterInteractionSummary.dominantSurface
                          ? ` 最常进入的界面入口是 ${matterInteractionSurfaceLabel(matterInteractionSummary.dominantSurface.label)}（${matterInteractionSummary.dominantSurface.count} 次）。`
                          : ""}
                      </div>
                      <div className="lm-matter-ops-meta">{matterInteractionSummary.dominantActionHint}</div>
                      {matterInteractionSummary.topLabels.length > 0 ? (
                        <>
                          <div className="lm-meta lm-matter-history-title">重复动作主题</div>
                          <ul className="lm-matter-ops-list">
                            {matterInteractionSummary.topLabels.map((item) => (
                              <li key={item.label}>
                                <div className="lm-matter-ops-title">
                                  <span>{item.label}</span>
                                  <span className="lm-matter-pill">{item.count} 次</span>
                                </div>
                                <div className="lm-matter-ops-meta">
                                  该主题在当前案件被多次触发，适合后续检查是否需要进一步收敛入口或模板。
                                </div>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  )}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-convergence-card">
                  <h3>交互收敛建议</h3>
                  {convergenceSuggestions.length === 0 ? (
                    <p className="lm-meta">当前案件还没有足够的交互轨迹来生成收敛建议。</p>
                  ) : (
                    <ul className="lm-matter-ops-list">
                      {convergenceSuggestions.map((item) => (
                        <li key={item.key}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <span className={`lm-matter-pill lm-matter-convergence-pill-${item.tone}`}>
                              {item.tone === "warn"
                                ? "优先处理"
                                : item.tone === "success"
                                  ? "可沉淀"
                                  : item.tone === "info"
                                    ? "可收敛"
                                    : "继续观察"}
                            </span>
                          </div>
                          <div className="lm-matter-ops-meta">{item.detail}</div>
                          <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                            <button
                              type="button"
                              className="lm-btn lm-btn-secondary lm-btn-small"
                              disabled={item.target.type === "none"}
                              onClick={() => handleConvergenceSuggestion(item)}
                            >
                              {item.actionLabel}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-product-card">
                  <h3>产品改造建议</h3>
                  <p className="lm-meta">
                    这部分不是给当前律师的下一步，而是根据本案重复操作，反推 LawMind 下一版工作台最该被增强的入口。
                  </p>
                  {productAdaptationSuggestions.length === 0 ? (
                    <p className="lm-meta">当前案件还没有足够的模式信号来推导产品改造建议。</p>
                  ) : (
                    <ul className="lm-matter-ops-list">
                      {productAdaptationSuggestions.map((item) => (
                        <li key={item.key}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <span className={`lm-matter-pill lm-matter-convergence-pill-${item.tone}`}>
                              {item.tone === "warn"
                                ? "应前置"
                                : item.tone === "success"
                                  ? "应产品化"
                                  : item.tone === "info"
                                    ? "应结构化"
                                    : "待验证"}
                            </span>
                          </div>
                          <div className="lm-matter-ops-meta">{item.detail}</div>
                          <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                            <button
                              type="button"
                              className="lm-btn lm-btn-secondary lm-btn-small"
                              disabled={item.target.type === "none"}
                              onClick={() => handleConvergenceSuggestion(item)}
                            >
                              {item.actionLabel}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-experiment-card">
                  <h3>产品实验清单</h3>
                  <p className="lm-meta">
                    这部分把产品改造建议继续拆成更可验证的实验项，方便后续判断某个改造方向到底值不值得正式产品化。
                  </p>
                  {productExperimentChecklist.length === 0 ? (
                    <p className="lm-meta">当前案件还没有足够的模式信号来生成产品实验清单。</p>
                  ) : (
                    <ul className="lm-matter-ops-list">
                      {productExperimentChecklist.map((item) => (
                        <li key={item.key}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <span className={`lm-matter-pill lm-matter-experiment-pill-${item.priority}`}>
                              {item.priority === "high" ? "高优先" : item.priority === "medium" ? "中优先" : "低优先"}
                            </span>
                          </div>
                          <div className="lm-matter-ops-meta">假设：{item.hypothesis}</div>
                          <div className="lm-matter-ops-meta">验证：{item.validation}</div>
                          <div className="lm-matter-ops-meta">当前信号：{item.signal}</div>
                          <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                            <button
                              type="button"
                              className="lm-btn lm-btn-secondary lm-btn-small"
                              disabled={item.target.type === "none"}
                              onClick={() => handleConvergenceSuggestion(item)}
                            >
                              {item.actionLabel}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-cross-experiment-card">
                  <h3>跨案件实验累积板</h3>
                  <p className="lm-meta">
                    这部分聚合全工作区案件的重复交互模式，帮助判断某条改造方向是否已经不只是本案问题，而开始变成跨案件共性问题。
                  </p>
                  {crossMatterExperimentBoard.length === 0 ? (
                    <p className="lm-meta">当前工作区还没有足够的跨案件交互数据来形成实验累积板。</p>
                  ) : (
                    <ul className="lm-matter-ops-list">
                      {crossMatterExperimentBoard.map((item) => (
                        <li key={item.key}>
                          <div className="lm-matter-ops-title">
                            <span>{item.title}</span>
                            <span className="lm-matter-pill">
                              {item.matterCount} 案件 · {item.totalEvents} 次
                            </span>
                          </div>
                          <div className="lm-matter-ops-meta">
                            已在 {item.matterCount} 个案件中出现，最近一次信号时间为 {formatShortDateTime(item.latestAt)}。
                          </div>
                          <div className="lm-matter-ops-meta">
                            示例案件：{item.exampleMatterIds.length > 0 ? item.exampleMatterIds.join(", ") : "暂无"}
                            {item.includesCurrentMatter ? " · 当前案件已包含在累积信号中" : ""}
                          </div>
                          {item.localSuggestion ? (
                            <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                              <button
                                type="button"
                                className="lm-btn lm-btn-secondary lm-btn-small"
                                onClick={() => {
                                  if (item.localSuggestion) {
                                    handleConvergenceSuggestion(item.localSuggestion);
                                  }
                                }}
                              >
                                查看本案对应建议
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="lm-matter-cockpit-card lm-matter-roadmap-card">
                  <h3>Roadmap 候选池</h3>
                  <p className="lm-meta">
                    这部分会把跨案件实验信号进一步压缩成更接近路线图排序的候选项，帮助判断哪些方向该现在做、哪些适合排到下一波。
                  </p>
                  {roadmapCandidates.length === 0 ? (
                    <p className="lm-meta">当前还没有足够的跨案件信号来生成路线图候选池。</p>
                  ) : (
                    <>
                      <div className="lm-matter-roadmap-summary-grid">
                        <div className="lm-matter-roadmap-summary-card">
                          <span className="lm-meta">候选方向</span>
                          <strong>{roadmapPressureSummary.candidateCount}</strong>
                        </div>
                        <div className="lm-matter-roadmap-summary-card">
                          <span className="lm-meta">现在做</span>
                          <strong>{roadmapPressureSummary.nowCount}</strong>
                        </div>
                        <div className="lm-matter-roadmap-summary-card">
                          <span className="lm-meta">已验证共性</span>
                          <strong>{roadmapPressureSummary.validatedCount}</strong>
                        </div>
                        <div className="lm-matter-roadmap-summary-card">
                          <span className="lm-meta">当前最高压力</span>
                          <strong>{roadmapPressureSummary.topCandidate?.title ?? "暂无"}</strong>
                        </div>
                      </div>
                      <ul className="lm-matter-ops-list">
                        {roadmapCandidates.map((item) => (
                          <li key={item.key} className="lm-matter-roadmap-decision-card">
                            <div className="lm-matter-ops-title">
                              <span>{item.title}</span>
                              <div className="lm-matter-ops-actions">
                                <span className={`lm-matter-pill lm-matter-roadmap-pill-${item.urgency}`}>
                                  {item.urgency === "now" ? "现在做" : item.urgency === "next" ? "下一波" : "后续观察"}
                                </span>
                                <span className={`lm-matter-pill lm-matter-roadmap-readiness-${item.readiness}`}>
                                  {item.readiness === "validated"
                                    ? "已验证"
                                    : item.readiness === "emerging"
                                      ? "正在成形"
                                      : "继续观察"}
                                </span>
                                <span className="lm-matter-pill">分数 {item.score}</span>
                              </div>
                            </div>
                            <div className="lm-matter-ops-meta">{item.rationale}</div>
                            <div className="lm-matter-ops-meta">
                              覆盖 {item.matterCount} 个案件 · 累计 {item.totalEvents} 次信号
                              {item.latestAt ? ` · 最近信号 ${formatShortDateTime(item.latestAt)}` : ""}
                            </div>
                            <div className="lm-matter-roadmap-detail-grid">
                              <div>
                                <span className="lm-meta">预期收益</span>
                                <div className="lm-matter-ops-meta">{item.benefit}</div>
                              </div>
                              <div>
                                <span className="lm-meta">主要风险</span>
                                <div className="lm-matter-ops-meta">{item.risk}</div>
                              </div>
                              <div>
                                <span className="lm-meta">建议 owner</span>
                                <div className="lm-matter-ops-meta">{item.owner}</div>
                              </div>
                            </div>
                            {item.localSuggestion ? (
                              <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                                <button
                                  type="button"
                                  className="lm-btn lm-btn-secondary lm-btn-small"
                                  onClick={() => {
                                    const suggestion = item.localSuggestion;
                                    if (!suggestion) {
                                      return;
                                    }
                                    handleConvergenceSuggestion(suggestion);
                                  }}
                                >
                                  打开本案对应入口
                                </button>
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>

                <section className="lm-matter-cockpit-card">
                  <h3>最近律师动作</h3>
                  {recentMatterInteractions.length === 0 ? (
                    <p className="lm-meta">当前案件还没有记录到关键律师动作。</p>
                  ) : (
                    <ul className="lm-matter-ops-list">
                      {recentMatterInteractions.map((event, index) => (
                        <li key={`${event.timestamp ?? "na"}:${index}`}>
                          <div className="lm-matter-ops-title">
                            <span>{auditKindLabel(event.kind)}</span>
                            <span className="lm-matter-pill">{formatShortDateTime(event.timestamp)}</span>
                          </div>
                          <div className="lm-matter-ops-meta">{event.detail ?? "无明细"}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="lm-matter-cockpit-grid">
                  <section className="lm-matter-cockpit-card">
                    <h3>下一步</h3>
                    {summary.nextActions.length === 0 ? (
                      <p className="lm-meta">暂无</p>
                    ) : (
                      <ul className="lm-bullet-list">
                        {summary.nextActions.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="lm-matter-cockpit-card">
                    <h3>工作队列</h3>
                    {filteredQueueItems.length === 0 ? (
                      <p className="lm-meta">当前无显式阻塞或待办队列。</p>
                    ) : (
                      <ul className="lm-matter-ops-list">
                        {filteredQueueItems.slice(0, 8).map((item) => (
                          <li key={item.queueItemId}>
                            <div className="lm-matter-ops-title">
                              <span>{item.title}</span>
                              <div className="lm-matter-ops-actions">
                                <span className={`lm-matter-pill lm-matter-pill-priority-${item.priority}`}>
                                  {priorityLabel(item.priority)}
                                </span>
                                {onOpenReview && item.relatedTaskId ? (
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-secondary lm-btn-small"
                                    onClick={() =>
                                      openReviewFromMatter(item.relatedTaskId!, {
                                        statusFilter: item.kind === "ready_to_render" ? "approved" : "pending",
                                        listMode: item.kind === "ready_to_render" ? "all" : "pending",
                                        sourceSurface: "queue",
                                        sourceLabel: item.title,
                                      })
                                    }
                                  >
                                    去审核
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <div className="lm-matter-ops-meta">
                              {queueKindLabel(item.kind)}
                              {item.detail ? ` · ${item.detail}` : ""}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="lm-matter-cockpit-card">
                    <h3>审批节点</h3>
                    {filteredApprovalRequests.length === 0 ? (
                      <p className="lm-meta">当前无待跟踪审批。</p>
                    ) : (
                      <ul className="lm-matter-ops-list">
                        {filteredApprovalRequests.slice(0, 8).map((item) => (
                          <li key={item.approvalId}>
                            <div className="lm-matter-ops-title">
                              <span>{approvalStatusLabel(item.status)}</span>
                              <div className="lm-matter-ops-actions">
                                <span className={`lm-matter-pill lm-matter-pill-status-${item.status}`}>
                                  {item.riskLevel.toUpperCase()}
                                </span>
                                {onOpenReview && item.deliverableId ? (
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-secondary lm-btn-small"
                                    onClick={() =>
                                      openReviewFromMatter(item.deliverableId!, {
                                        statusFilter:
                                          item.status === "approved"
                                            ? "approved"
                                            : item.status === "needs_changes"
                                              ? "modified"
                                              : "all",
                                        listMode: item.status === "pending" ? "pending" : "all",
                                        sourceSurface: "approval",
                                        sourceLabel: item.reason,
                                      })
                                    }
                                  >
                                    去审核
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <div className="lm-matter-ops-meta">{item.reason}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="lm-matter-cockpit-card">
                    <h3>交付物状态</h3>
                    {filteredDrafts.length === 0 ? (
                      <p className="lm-meta">暂无草稿或交付物。</p>
                    ) : (
                      <ul className="lm-matter-ops-list">
                        {filteredDrafts.slice(0, 8).map((draft) => (
                          <li key={draft.taskId}>
                            <div className="lm-matter-ops-title">
                              <span>{draft.title}</span>
                              <div className="lm-matter-ops-actions">
                                <span className={`lm-matter-pill lm-matter-pill-status-${draft.reviewStatus}`}>
                                  {reviewStatusLabel(draft.reviewStatus)}
                                </span>
                                {onOpenReview ? (
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-secondary lm-btn-small"
                                    onClick={() =>
                                      openReviewFromMatter(draft.taskId, {
                                        matterId: draft.matterId,
                                        statusFilter: draft.reviewStatus,
                                        listMode: draft.reviewStatus === "pending" ? "pending" : "all",
                                        sourceSurface: "draft-status",
                                        sourceLabel: draft.title,
                                      })
                                    }
                                  >
                                    去审核
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <div className="lm-matter-ops-meta">
                              {draft.templateId}
                              <DraftCitationBadge cit={draftCitationByTask[draft.taskId]} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <section className="lm-matter-cockpit-card">
                  <h3>关键风险</h3>
                  {summary.keyRisks.length === 0 ? (
                    <p className="lm-meta">暂无</p>
                  ) : (
                    <ul className="lm-bullet-list">
                      {summary.keyRisks.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="lm-matter-cockpit-card">
                  <h3>近期进展</h3>
                  <ul className="lm-bullet-list">
                    {summary.recentActivity.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </section>
                {overview && (
                  <section className="lm-meta lm-matter-cockpit-footnote">
                    争点示例：{overview.topIssue ?? "—"} · 风险条数 {overview.riskCount} · 产物{" "}
                    {overview.artifactCount} · 队列 {queueItems.length} · 审批 {approvalRequests.length}
                  </section>
                )}
              </div>
            )}

            {panelTab === "case" && (
              <div className="lm-workbench-panel">
                {caseFocusContext && (
                  <div className="lm-case-focus-banner-wrap">
                    <div className="lm-case-focus-banner">
                      <div>
                        <strong>{caseFocusContext.title}</strong>
                        <div className="lm-meta">{caseFocusContext.hint}</div>
                      </div>
                      <div className="lm-matter-ops-actions">
                        {caseFocusContext.query ? (
                          <button
                            type="button"
                            className="lm-btn lm-btn-secondary lm-btn-small"
                            disabled={searchBusy}
                            onClick={() => void runSearch()}
                          >
                            定位相关内容
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="lm-btn lm-btn-secondary lm-btn-small"
                          disabled={caseActionBusy}
                          onClick={() => void writeCaseFocusNote()}
                        >
                          写入案件档案
                        </button>
                        <button
                          type="button"
                          className="lm-btn lm-btn-secondary lm-btn-small"
                          onClick={() => setCaseFocusContext(null)}
                        >
                          清除提示
                        </button>
                      </div>
                    </div>
                    <div className="lm-case-draft-variants">
                      {([
                        ["conservative", "保守版"],
                        ["standard", "标准版"],
                        ["assertive", "强化版"],
                      ] as const).map(([variant, label]) => (
                        <button
                          key={variant}
                          type="button"
                          className={`lm-tab ${caseDraftVariant === variant ? "active" : ""}`}
                          onClick={() => {
                            setCaseDraftVariant(variant);
                            setCaseDraftNote(buildCaseFocusDraft(caseFocusContext, variant));
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="lm-meta lm-case-draft-variant-help">
                      保守版更适合先留边界，标准版用于日常记录，强化版适合推动明确结论或下一步动作。
                    </div>
                    <label className="lm-field lm-case-focus-draft">
                      <span>建议草稿</span>
                      <textarea
                        value={caseDraftNote}
                        onChange={(e) => setCaseDraftNote(e.target.value)}
                        rows={4}
                        placeholder="在此补充更完整的案件说明后再写入。"
                      />
                    </label>
                    {caseActionMsg ? <div className="lm-meta lm-matter-action-msg">{caseActionMsg}</div> : null}
                  </div>
                )}
                <div className="lm-case-search">
                  <input
                    type="search"
                    placeholder="在本案内搜索（争点、任务、草稿、审计）"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void runSearch();
                      }
                    }}
                  />
                  <button type="button" className="lm-btn lm-btn-secondary" disabled={searchBusy} onClick={() => void runSearch()}>
                    {searchBusy ? "…" : "搜索"}
                  </button>
                </div>
                {searchHits.length > 0 && (
                  <ul className="lm-search-hits">
                    {searchHits.map((h, i) => (
                      <li key={i}>
                        <span className="lm-search-hit-section">{h.section}</span>
                        <div>{h.text}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <h3 ref={coreIssuesRef}>核心争点</h3>
                <ul className="lm-bullet-list">
                  {coreIssues.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3 ref={riskNotesRef}>风险与待确认</h3>
                <ul className="lm-bullet-list">
                  {riskNotes.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3 ref={artifactsRef}>生成产物</h3>
                <ul className="lm-bullet-list">
                  {artifacts.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3 ref={caseMdRef}>CASE.md {caseTruncated ? "（已截断显示）" : ""}</h3>
                <pre className="lm-case-md">{caseMemory}</pre>
              </div>
            )}

            {panelTab === "tasks" && (
              <div className="lm-workbench-panel lm-two-col">
                <div>
                  <h3>任务</h3>
                  <ul className="lm-bullet-list">
                    {tasks.map((t) => (
                      <li key={t.taskId}>
                        <strong>{t.status}</strong> — {t.summary.slice(0, 200)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>草稿</h3>
                  <ul className="lm-bullet-list">
                    {drafts.map((d) => (
                      <li key={d.taskId}>
                        {d.title} — <em>{d.reviewStatus}</em>{" "}
                        <DraftCitationBadge cit={draftCitationByTask[d.taskId]} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {panelTab === "timeline" && (
              <div className="lm-workbench-panel">
                <h3>工作进展</h3>
                <ul className="lm-bullet-list">
                  {progressEntries.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3>审计事件</h3>
                <ul className="lm-audit-list">
                  {auditEvents.map((e, i) => (
                    <li key={i}>
                      <span className="lm-audit-kind">{auditKindLabel(e.kind)}</span>
                      <span className="lm-audit-time">{e.timestamp}</span>
                      <div className="lm-audit-detail">{e.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {panelTab === "cognition" && (
              <div className="lm-workbench-panel">
                <section className="lm-matter-cockpit-card lm-matter-cognition-card">
                  <div className="lm-matter-cognition-head">
                    <div>
                      <h3>当前案件认知面板</h3>
                      <p className="lm-meta">
                        选择一份最能代表当前案件状态的草稿，查看它受哪些记忆层驱动，以及对应的法律推理结构。
                      </p>
                    </div>
                    <label className="lm-field lm-matter-cognition-select">
                      <span>观察草稿</span>
                      <select
                        value={cognitionTaskId ?? ""}
                        onChange={(e) => setCognitionTaskId(e.target.value || null)}
                        disabled={drafts.length === 0}
                      >
                        {drafts.length === 0 ? (
                          <option value="">暂无草稿</option>
                        ) : (
                          drafts.map((draft) => (
                            <option key={draft.taskId} value={draft.taskId}>
                              {reviewStatusLabel(draft.reviewStatus)} · {draft.title}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>

                  {cognitionBoardLoading ? <div className="lm-meta">汇总案件认知摘要…</div> : null}
                  {cognitionBoardError ? <div className="lm-error">{cognitionBoardError}</div> : null}
                  {cognitionBoard ? (
                    <div className="lm-matter-cognition-board">
                      <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                        <div className="lm-matter-summary-top">
                          <span className="lm-matter-summary-title">观察草稿</span>
                          <span className="lm-matter-summary-count">{cognitionBoard.observedDraftCount}</span>
                        </div>
                        <div className="lm-matter-summary-hint">当前案件认知板已采样的关键草稿数。</div>
                      </div>
                      <div className="lm-matter-summary-card lm-matter-summary-card-info">
                        <div className="lm-matter-summary-top">
                          <span className="lm-matter-summary-title">推理快照</span>
                          <span className="lm-matter-summary-count">{cognitionBoard.reasoningDraftCount}</span>
                        </div>
                        <div className="lm-matter-summary-hint">
                          含 `LegalReasoningGraph` 快照的草稿数，缺失 {cognitionBoard.missingReasoningCount}。
                        </div>
                      </div>
                      <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                        <div className="lm-matter-summary-top">
                          <span className="lm-matter-summary-title">记忆层覆盖</span>
                          <span className="lm-matter-summary-count">{cognitionBoard.uniqueMemoryLayerCount}</span>
                        </div>
                        <div className="lm-matter-summary-hint">跨关键草稿累计命中的唯一记忆层数量。</div>
                      </div>
                      <div className="lm-matter-summary-card lm-matter-summary-card-success">
                        <div className="lm-matter-summary-top">
                          <span className="lm-matter-summary-title">已注入提示</span>
                          <span className="lm-matter-summary-count">{cognitionBoard.injectedMemoryLayerCount}</span>
                        </div>
                        <div className="lm-matter-summary-hint">
                          已进入 system prompt 的核心记忆层数量，未注入高频层 {cognitionBoard.uncoveredFrequentLayerCount}。
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {cognitionBoard ? (
                    <div className="lm-matter-cognition-grid">
                      <section className="lm-matter-cockpit-card">
                        <h3>认知风险信号</h3>
                        <ul className="lm-bullet-list">
                          <li>缺推理快照草稿：{cognitionBoard.missingReasoningCount}</li>
                          <li>引用待核或无快照草稿：{cognitionBoard.missingCitationCount}</li>
                          <li>高频但未注入提示的记忆层：{cognitionBoard.uncoveredFrequentLayerCount}</li>
                          <li>
                            采样时间跨度：{formatShortDateTime(cognitionBoard.oldestDraftAt)} 至{" "}
                            {formatShortDateTime(cognitionBoard.newestDraftAt)}
                          </li>
                        </ul>
                      </section>
                      <section className="lm-matter-cockpit-card">
                        <h3>记忆层分层</h3>
                        <div className="lm-matter-memory-category-grid">
                          {cognitionBoard.memoryCategories.map((category) => (
                            <div key={category.key} className="lm-matter-memory-category">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">{category.title}</span>
                                <span className="lm-matter-summary-count">{category.count}</span>
                              </div>
                              <div className="lm-matter-summary-hint">{category.hint}</div>
                            </div>
                          ))}
                        </div>
                        {cognitionBoard.missingMemoryLayers.length > 0 ? (
                          <ul className="lm-matter-ops-list lm-matter-memory-missing-list">
                            {cognitionBoard.missingMemoryLayers.map((layer) => (
                              <li key={layer.label}>
                                <div className="lm-matter-ops-title">
                                  <span>{layer.label}</span>
                                  <span className="lm-matter-pill">{layer.count} 次缺失</span>
                                </div>
                                <div className="lm-matter-ops-meta">
                                  该记忆层在多份草稿认知路径中被期待，但对应文件当前并不存在。
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="lm-meta">当前关键草稿没有发现持续缺失的记忆层。</p>
                        )}
                      </section>
                      <section className="lm-matter-cockpit-card">
                        <h3>升级建议</h3>
                        {cognitionBoard.upgradeSuggestions.length === 0 ? (
                          <p className="lm-meta">当前没有明显需要提升为核心记忆的高频候选层。</p>
                        ) : (
                          <ul className="lm-matter-ops-list">
                            {cognitionBoard.upgradeSuggestions.map((item) => (
                              <li key={item.label}>
                                <div className="lm-matter-ops-title">
                                  <span>{item.label}</span>
                                  <span className="lm-matter-pill">{item.count} 次命中</span>
                                </div>
                                <div className="lm-matter-ops-meta">{item.recommendation}</div>
                                <div className="lm-matter-ops-actions lm-matter-upgrade-actions">
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-secondary lm-btn-small"
                                    disabled={cognitionActionBusy === `lawyer:${item.label}`}
                                    onClick={() => void saveUpgradeSuggestion("lawyer", item)}
                                  >
                                    写入律师档案
                                  </button>
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-secondary lm-btn-small"
                                    disabled={cognitionActionBusy === `assistant:${item.label}`}
                                    onClick={() => void saveUpgradeSuggestion("assistant", item)}
                                  >
                                    写入助手档案
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        {cognitionActionMsg ? <div className="lm-meta lm-matter-action-msg">{cognitionActionMsg}</div> : null}
                      </section>
                      <section className="lm-matter-cockpit-card">
                        <h3>已采纳建议</h3>
                        {visiblePersistentAdoptions.length > 0 ? (
                          <div className="lm-matter-cognition-board lm-matter-adoption-board">
                            <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">持久记录</span>
                                <span className="lm-matter-summary-count">{adoptionHistoryInsight.total}</span>
                              </div>
                              <div className="lm-matter-summary-hint">当前案件可追溯的认知升级建议采纳次数。</div>
                            </div>
                            <div className="lm-matter-summary-card lm-matter-summary-card-info">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">律师档案</span>
                                <span className="lm-matter-summary-count">{adoptionHistoryInsight.lawyerCount}</span>
                              </div>
                              <div className="lm-matter-summary-hint">沉淀进长期个人记忆的采纳条目。</div>
                            </div>
                            <div className="lm-matter-summary-card lm-matter-summary-card-success">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">助手档案</span>
                                <span className="lm-matter-summary-count">{adoptionHistoryInsight.assistantCount}</span>
                              </div>
                              <div className="lm-matter-summary-hint">沉淀进当前助手行为记忆的采纳条目。</div>
                            </div>
                            <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">覆盖案件</span>
                                <span className="lm-matter-summary-count">{adoptionHistoryInsight.crossMatterCount}</span>
                              </div>
                              <div className="lm-matter-summary-hint">这些采纳记录已经分布到多少个不同案件。</div>
                            </div>
                            <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">重复采纳</span>
                                <span className="lm-matter-summary-count">{adoptionHistoryInsight.repeatedLabels.length}</span>
                              </div>
                              <div className="lm-matter-summary-hint">说明这些建议可能已经开始跨回合复用。</div>
                            </div>
                            <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                              <div className="lm-matter-summary-top">
                                <span className="lm-matter-summary-title">最近采纳</span>
                                <span className="lm-matter-summary-count">
                                  {adoptionHistoryInsight.latestSavedAt
                                    ? formatShortDateTime(adoptionHistoryInsight.latestSavedAt)
                                    : "--"}
                                </span>
                              </div>
                              <div className="lm-matter-summary-hint">帮助判断这套认知升级规则最近是否仍在被复用。</div>
                            </div>
                          </div>
                        ) : null}
                        {visiblePersistentAdoptions.length === 0 && adoptedSuggestions.length === 0 ? (
                          <p className="lm-meta">当前案件还没有可见的认知建议采纳记录。</p>
                        ) : (
                          <>
                            {adoptionHistoryInsight.repeatedLabels.length > 0 ? (
                              <div className="lm-matter-cockpit-card lm-matter-adoption-repeat-card">
                                <h3>复用信号</h3>
                                <ul className="lm-matter-ops-list">
                                  {adoptionHistoryInsight.repeatedLabels.map((item) => (
                                    <li key={item.label}>
                                      <div className="lm-matter-ops-title">
                                        <span>{item.label}</span>
                                        <span className="lm-matter-pill">{item.count} 次采纳</span>
                                      </div>
                                      <div className="lm-matter-ops-meta">
                                        这条建议已多次被采纳
                                        {item.matterIds.length > 0 ? ` · 关联案件 ${item.matterIds.join(", ")}` : ""}
                                        {item.latestSavedAt ? ` · 最近一次 ${formatShortDateTime(item.latestSavedAt)}` : ""}
                                        ，说明它可能正在变成稳定的复用规则。
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {visiblePersistentAdoptions.length > 0 ? (
                              <>
                                <div className="lm-meta lm-matter-history-title">持久历史</div>
                                <ul className="lm-matter-ops-list">
                                  {visiblePersistentAdoptions.map((item) => (
                                    <li key={item.key}>
                                      <div className="lm-matter-ops-title">
                                        <span>{item.label}</span>
                                        <span className="lm-matter-pill">
                                          {item.target === "lawyer" ? "律师档案" : "助手档案"}
                                        </span>
                                      </div>
                                      <div className="lm-matter-ops-meta">
                                        {item.matterId ? `案件 ${item.matterId}` : "案件未记录"}
                                        {item.draftTitle ? ` · ${item.draftTitle}` : ""}
                                        {item.taskId ? ` · task ${item.taskId}` : ""}
                                      </div>
                                      <div className="lm-matter-ops-meta">采纳时间：{formatShortDateTime(item.savedAt)}</div>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : null}
                            {adoptedSuggestions.length > 0 ? (
                              <>
                                <div className="lm-meta lm-matter-history-title">本次会话新增</div>
                                <ul className="lm-matter-ops-list">
                                  {adoptedSuggestions.map((item) => (
                                    <li key={item.key}>
                                      <div className="lm-matter-ops-title">
                                        <span>{item.label}</span>
                                        <span className="lm-matter-pill">
                                          {item.target === "lawyer" ? "律师档案" : "助手档案"}
                                        </span>
                                      </div>
                                      <div className="lm-matter-ops-meta">
                                        {item.matterId ? `案件 ${item.matterId}` : "案件未记录"}
                                        {item.draftTitle ? ` · ${item.draftTitle}` : ""}
                                        {item.taskId ? ` · task ${item.taskId}` : ""}
                                      </div>
                                      <div className="lm-matter-ops-meta">采纳时间：{formatShortDateTime(item.savedAt)}</div>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : null}
                          </>
                        )}
                      </section>
                      <section className="lm-matter-cockpit-card">
                        <h3>高频记忆层</h3>
                        {cognitionBoard.topMemoryLayers.length === 0 ? (
                          <p className="lm-meta">暂无记忆来源数据。</p>
                        ) : (
                          <ul className="lm-matter-ops-list">
                            {cognitionBoard.topMemoryLayers.map((layer) => (
                              <li key={layer.label}>
                                <div className="lm-matter-ops-title">
                                  <span>{layer.label}</span>
                                  <div className="lm-matter-ops-actions">
                                    <span className="lm-matter-pill">{layer.count} 份草稿</span>
                                    <span className={`lm-matter-pill ${layer.injected ? "lm-matter-pill-status-approved" : ""}`}>
                                      {layer.injected ? "已注入" : "仅检索"}
                                    </span>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section className="lm-matter-cockpit-card">
                        <h3>推理覆盖</h3>
                        <ul className="lm-matter-ops-list">
                          {cognitionBoard.draftCoverage.map((item) => (
                            <li key={item.taskId}>
                              <div className="lm-matter-ops-title">
                                <span>{item.title}</span>
                                <div className="lm-matter-ops-actions">
                                  <span className={`lm-matter-pill lm-matter-pill-status-${item.status}`}>
                                    {reviewStatusLabel(item.status)}
                                  </span>
                                  <span className={`lm-matter-pill ${item.hasReasoning ? "lm-matter-pill-status-approved" : ""}`}>
                                    {item.hasReasoning ? "有推理" : "无快照"}
                                  </span>
                                </div>
                              </div>
                              <div className="lm-matter-ops-meta">记忆层 {item.memoryLayerCount} · taskId {item.taskId}</div>
                              <div className="lm-matter-ops-meta">
                                {item.hasReasoning ? "推理已留痕" : "推理缺快照"} ·{" "}
                                {item.citationState === "ok"
                                  ? "引用已核对"
                                  : item.citationState === "warn"
                                    ? "引用待核"
                                    : "无检索快照"}{" "}
                                · {formatShortDateTime(item.createdAt)}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                  ) : null}

                  {cognitionDraft && (
                    <div className="lm-matter-cognition-meta">
                      <span className={`lm-matter-pill lm-matter-pill-status-${cognitionDraft.reviewStatus}`}>
                        {reviewStatusLabel(cognitionDraft.reviewStatus)}
                      </span>
                      <span className="lm-meta">模板 {cognitionDraft.templateId}</span>
                      <span className="lm-meta">创建于 {cognitionDraft.createdAt}</span>
                      <DraftCitationBadge cit={draftCitationByTask[cognitionDraft.taskId]} />
                      {onOpenReview ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-secondary lm-btn-small"
                          onClick={() =>
                            openReviewFromMatter(cognitionDraft.taskId, {
                              matterId: cognitionDraft.matterId,
                              statusFilter: cognitionDraft.reviewStatus,
                              listMode: cognitionDraft.reviewStatus === "pending" ? "pending" : "all",
                              sourceSurface: "cognition",
                              sourceLabel: cognitionDraft.title,
                            })
                          }
                        >
                          去审核
                        </button>
                      ) : null}
                    </div>
                  )}

                  {cognitionError && <div className="lm-error">{cognitionError}</div>}
                  {cognitionLoading ? <div className="lm-meta">加载认知面板…</div> : null}
                  {!cognitionLoading && !cognitionDraft ? (
                    <div className="lm-meta">当前案件还没有足够的草稿可供观察。</div>
                  ) : null}
                  {!cognitionLoading && cognitionDraft ? (
                    <div className="lm-matter-cognition-panels">
                      <LawmindMemorySourcesPanel
                        layers={cognitionMemorySources}
                        variant="workbench"
                        defaultOpen
                      />
                      {cognitionReasoningMarkdown ? (
                        <LawmindReasoningCollapsible
                          markdown={cognitionReasoningMarkdown}
                          variant="workbench"
                          defaultOpen
                          title="当前案件推理板"
                        />
                      ) : (
                        <section className="lm-matter-cockpit-card">
                          <h3>当前案件推理板</h3>
                          <p className="lm-meta">该草稿暂无可展示的推理快照。</p>
                        </section>
                      )}
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}
