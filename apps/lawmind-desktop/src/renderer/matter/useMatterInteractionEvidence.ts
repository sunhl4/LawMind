import { useCallback, useMemo } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { CaseDraftVariant, CaseFocusContext } from "./matter-case-focus";
import {
  blockingNextAction,
  parseMatterInteractionEvent,
  type AuditEventRow,
  type MatterInteractionSummary,
  type MatterSearchHit,
} from "./matter-interaction";
import { apiAuthHeaders } from "../lawmind-api-auth.ts";
import type { MatterPanelTab } from "./useMatterWorkbench";

export function useMatterInteractionEvidence(input: {
  apiBase: string;
  matterId: string | null;
  auditEvents: AuditEventRow[];
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEventRow[]>>;
  queueItems: WorkQueueItem[];
  reviewTargetForFocus: { statusFilter: ArtifactDraft["reviewStatus"] | "all"; listMode: "pending" | "all" };
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  setPanelTab: (tab: MatterPanelTab) => void;
  setCaseFocusContext: (ctx: CaseFocusContext | null) => void;
  setSearchQ: (q: string) => void;
  setSearchHits: (hits: MatterSearchHit[]) => void;
}) {
  const {
    apiBase,
    matterId,
    auditEvents,
    setAuditEvents,
    queueItems,
    reviewTargetForFocus,
    onOpenReview,
    setPanelTab,
    setCaseFocusContext,
    setSearchQ,
    setSearchHits,
  } = input;

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
      dominantAction === "review" ? "审核往返最频繁" : dominantAction === "memory" ? "认知沉淀最活跃" : "案件档案补录最频繁";
    const dominantActionHint =
      dominantAction === "review"
        ? "律师最近更多是在文书台和案件页之间来回切换，说明草稿把关仍是当前主工作面。"
        : dominantAction === "memory"
          ? "律师最近更常把高频经验沉淀进长期记忆，说明认知升级机制开始被实际使用。"
          : "律师最近更常把阻塞信息写回案件档案，说明案件档案正在成为推进案件的实际操作面。";
    return {
      total: interactions.length,
      latestAt: interactions
        .map((item) => item.event.timestamp)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
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
      if (!matterId) {
        return;
      }
      try {
        const r = await fetch(`${apiBase}/api/matters/interaction`, {
          method: "POST",
          headers: { "content-type": "application/json", ...apiAuthHeaders() },
          body: JSON.stringify({
            matterId,
            taskId: params.taskId,
            action: params.action,
            surface: params.surface,
            label: params.label,
            target: params.target,
            variant: params.variant,
            section: params.section,
          }),
        });
        const j = (await r.json()) as { ok?: boolean; event?: AuditEventRow };
        if (r.ok && j.ok && j.event) {
          const event = j.event;
          setAuditEvents((prev) =>
            [...prev, event].toSorted((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
          );
        }
      } catch {
        /* best effort */
      }
    },
    [apiBase, matterId, setAuditEvents],
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
          reviewBlockers[0]?.detail ?? "当前至少有草稿还在等待律师或上级确认，交付动作不应继续推进。",
        count: reviewBlockers.length,
        nextAction: blockingNextAction(reviewBlockers[0]?.kind ?? "need_lawyer_review"),
        actionLabel: "进入文书台",
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
          evidenceBlockers[0]?.detail ?? "当前案件仍缺关键事实、证据或冲突检查信息，推理与交付可信度不足。",
        count: evidenceBlockers.length,
        nextAction: blockingNextAction(evidenceBlockers[0]?.kind ?? "need_evidence"),
        actionLabel: "去案件档案",
        actionTab: "case",
        caseFocusContext: {
          title: "材料与事实阻塞",
          hint: "建议先在案件档案里补充事实缺口、证据线索或客户待答问题。",
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
          strategyBlockers[0]?.detail ?? "案件还没有沉淀出稳定的核心争点和任务目标，后续执行会反复返工。",
        count: strategyBlockers.length,
        nextAction: blockingNextAction(strategyBlockers[0]?.kind ?? "blocked_by_missing_strategy"),
        actionLabel: "去案件档案",
        actionTab: "case",
        caseFocusContext: {
          title: "策略尚未定型",
          hint: "建议先在案件档案或本案策略中补齐核心争点、目标和底线。",
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
        detail: renderReady[0]?.detail ?? "已有审核通过的草稿，但最终渲染和交付动作尚未执行。",
        count: renderReady.length,
        nextAction: blockingNextAction(renderReady[0]?.kind ?? "ready_to_render"),
        actionLabel: "进入文书台",
        actionTaskId: renderReady[0]?.relatedTaskId,
      });
    }

    return explanations.slice(0, 4);
  }, [queueItems]);

  const openReviewFromMatter = useCallback(
    (
      taskId: string,
      overrides?: {
        matterId?: string;
        statusFilter?: ArtifactDraft["reviewStatus"] | "all";
        listMode?: "pending" | "all";
        sourceSurface?: string;
        sourceLabel?: string;
      },
    ) => {
      if (!onOpenReview) {
        return;
      }
      void logMatterInteraction({
        action: "open_review",
        taskId,
        surface: overrides?.sourceSurface ?? "overview",
        label: overrides?.sourceLabel ?? "进入文书台",
      });
      onOpenReview({
        taskId,
        matterId: overrides?.matterId ?? matterId ?? undefined,
        statusFilter: overrides?.statusFilter ?? reviewTargetForFocus.statusFilter,
        listMode: overrides?.listMode ?? reviewTargetForFocus.listMode,
      });
    },
    [logMatterInteraction, onOpenReview, reviewTargetForFocus, matterId],
  );

  const handleBlockingAction = useCallback(
    (item: { actionTaskId?: string; actionTab?: "case" | "tasks"; caseFocusContext?: CaseFocusContext }) => {
      if (item.actionTaskId) {
        openReviewFromMatter(item.actionTaskId, {
          sourceSurface: "blocked-by",
          sourceLabel: item.caseFocusContext?.title ?? "阻塞因素",
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
    [openReviewFromMatter, setPanelTab, setCaseFocusContext, setSearchQ, setSearchHits],
  );

  return {
    recentMatterInteractions,
    matterInteractionSummary,
    logMatterInteraction,
    blockingExplanations,
    openReviewFromMatter,
    handleBlockingAction,
  };
}
