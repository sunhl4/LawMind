import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/index.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import { apiGetJson, apiSendJson, errorMessage, messageFromOkFalseBody } from "../api-client";
import type { CaseFocusContext } from "./matter-case-focus";
import {
  type AdoptionHistoryInsight,
  type AdoptedSuggestionRecord,
  type MatterCognitionBoard,
  type MatterConvergenceSuggestion,
  type MatterCrossExperimentRollupItem,
  type MatterInteractionSummary,
  type MatterProductAdaptationSuggestion,
  type MatterProductExperimentItem,
  type MatterRecommendationTarget,
  type MatterRoadmapCandidate,
  type MatterSearchHit,
  type PersistentAdoptionItem,
  matterInteractionSurfaceLabel,
  memoryUpgradeRecommendation,
} from "./matter-interaction";
import type { MatterPanelTab } from "./useMatterWorkbench";

type BlockingExplanationInput = {
  actionTab?: "case" | "tasks";
  caseFocusContext?: CaseFocusContext;
};

export type UseMatterProductIntelligenceParams = {
  apiBase: string;
  assistantId?: string;
  matterId: string | null;
  refreshVersion: number;
  showCrossMatterRoadmap: boolean;
  drafts: ArtifactDraft[];
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  matterInteractionSummary: MatterInteractionSummary;
  blockingExplanations: BlockingExplanationInput[];
  caseFocusContext: CaseFocusContext | null;
  logMatterInteraction: (params: {
    action: "open_review" | "save_upgrade_suggestion" | "write_case_note";
    taskId?: string;
    surface: string;
    label: string;
    target?: "lawyer" | "assistant";
  }) => Promise<void>;
  openReviewFromMatter: (
    taskId: string,
    overrides?: {
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
      sourceSurface?: string;
      sourceLabel?: string;
    },
  ) => void;
  setPanelTab: (tab: MatterPanelTab) => void;
  setCaseFocusContext: (ctx: CaseFocusContext | null) => void;
  setSearchQ: (q: string) => void;
  setSearchHits: (hits: MatterSearchHit[]) => void;
};

export function useMatterProductIntelligence(params: UseMatterProductIntelligenceParams) {
  const {
    apiBase,
    assistantId,
    matterId,
    refreshVersion,
    showCrossMatterRoadmap,
    drafts,
    draftCitationByTask,
    matterInteractionSummary,
    blockingExplanations,
    caseFocusContext,
    logMatterInteraction,
    openReviewFromMatter,
    setPanelTab,
    setCaseFocusContext,
    setSearchQ,
    setSearchHits,
  } = params;

  const [cognitionReasoningReport, setCognitionReasoningReport] = useState<
    import("../../../../../src/lawmind/deliverables/index.ts").ReasoningReport | null
  >(null);
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
  const prevSelectedMatterForCognitionRef = useRef<string | null>(null);

  const pendingDrafts = useMemo(
    () => drafts.filter((draft) => draft.reviewStatus === "pending"),
    [drafts],
  );
  const modifiedDrafts = useMemo(
    () => drafts.filter((draft) => draft.reviewStatus === "modified"),
    [drafts],
  );
  const approvedDrafts = useMemo(
    () => drafts.filter((draft) => draft.reviewStatus === "approved"),
    [drafts],
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
    return ordered
      .filter((draft) => {
        if (seen.has(draft.taskId)) {
          return false;
        }
        seen.add(draft.taskId);
        return true;
      })
      .slice(0, 6);
  }, [approvedDrafts, drafts, modifiedDrafts, pendingDrafts]);

  const cognitionBoardCitationFingerprint = useMemo(
    () =>
      cognitionBoardDrafts
        .map((d) => {
          const c = draftCitationByTask[d.taskId];
          const ok = c && c.checked ? c.ok : false;
          return `${d.taskId}:${Boolean(c?.checked)}:${Boolean(ok)}`;
        })
        .join("|"),
    [cognitionBoardDrafts, draftCitationByTask],
  );

  const convergenceSuggestions = useMemo<MatterConvergenceSuggestion[]>(() => {
    const suggestions: MatterConvergenceSuggestion[] = [];

    if (matterInteractionSummary.reviewOpenCount >= 3) {
      const targetDraft = pendingDrafts[0] ?? modifiedDrafts[0] ?? approvedDrafts[0] ?? drafts[0];
      suggestions.push({
        key: "review-loop",
        title: "审核入口仍是主工作面",
        detail:
          "当前案件多次从案件概览进入文书台，说明律师还在围绕草稿把关来回切换。可以继续把关键审核决策前置到案件概览。",
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
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ??
        caseFocusContext ??
        undefined;
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
          "当前案件多次从案件概览进入文书台，说明概览页还缺少足够的审核上下文。下一版应把审核理由、修改标签和引用状态更早暴露出来。",
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
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ??
        caseFocusContext ??
        undefined;
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
          hypothesis: "如果在概览页提前暴露审核理由、引用状态和修改标签，律师进入文书台的往返次数会下降。",
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
          hypothesis: "如果高频升级建议更早出现在案件概览里，律师会更愿意及时沉淀长期记忆，而不是等到认知深层再操作。",
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
  }, [
    matterInteractionSummary.caseWriteCount,
    matterInteractionSummary.memorySaveCount,
    matterInteractionSummary.reviewOpenCount,
    productAdaptationSuggestions,
  ]);

  const crossMatterExperimentBoard = useMemo(() => {
    return crossExperimentRollup.map((item) => {
      const localSuggestion =
        productAdaptationSuggestions.find((suggestion) => suggestion.key === item.key) ??
        convergenceSuggestions.find((suggestion) => suggestion.key === item.key);
      return {
        ...item,
        includesCurrentMatter: Boolean(matterId && item.exampleMatterIds.includes(matterId)),
        localSuggestion,
      };
    });
  }, [convergenceSuggestions, crossExperimentRollup, productAdaptationSuggestions, matterId]);

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
            ? "多个案件都在重复把审核上下文留到文书台，说明概览层的信息前置价值最高。"
            : item.key === "adapt-case-form"
              ? "多个案件都在反复补 CASE 文本，说明结构化补录已经接近共性需求。"
              : item.key === "adapt-memory-fastlane"
                ? "多个案件都在持续沉淀长期记忆，说明认知升级正在从偶发动作走向常规流程。"
                : "同一入口在多个案件中持续高频出现，说明默认展示顺序可能已经需要调整。";
        const owner =
          item.key === "adapt-review-surface"
            ? "案件概览 / 文书台"
            : item.key === "adapt-case-form"
              ? "CASE 档案层"
              : item.key === "adapt-memory-fastlane"
                ? "认知面板"
                : "工作台框架";
        const benefit =
          item.key === "adapt-review-surface"
            ? "减少律师在概览与文书台之间的来回切换，把关键待审信号前置到主工作面。"
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
      .toSorted((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"))
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
    [openReviewFromMatter, setCaseFocusContext, setPanelTab, setSearchHits, setSearchQ],
  );

  const loadPersistentAdoptions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (assistantId) {
        params.set("assistantId", assistantId);
      }
      const q = params.toString();
      const j = await apiGetJson<{ ok?: boolean; items?: PersistentAdoptionItem[] }>(
        apiBase,
        `/api/memory/adoptions${q ? `?${q}` : ""}`,
      );
      if (!j.ok || !Array.isArray(j.items)) {
        return;
      }
      const items = j.items.map((item, index) => {
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
      });
      setPersistentAdoptions(items);
    } catch {
      setPersistentAdoptions([]);
    }
  }, [apiBase, assistantId]);

  const loadCrossExperimentRollup = useCallback(async () => {
    try {
      const j = await apiGetJson<{
        ok?: boolean;
        items?: MatterCrossExperimentRollupItem[];
      }>(apiBase, "/api/matters/interaction-rollup");
      if (!j.ok || !Array.isArray(j.items)) {
        return;
      }
      setCrossExperimentRollup(j.items);
    } catch {
      setCrossExperimentRollup([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadPersistentAdoptions();
  }, [loadPersistentAdoptions, matterId]);

  useEffect(() => {
    if (!showCrossMatterRoadmap) {
      setCrossExperimentRollup([]);
      return;
    }
    void loadCrossExperimentRollup();
  }, [loadCrossExperimentRollup, refreshVersion, showCrossMatterRoadmap]);

  const adoptionHistoryInsight = useMemo<AdoptionHistoryInsight>(() => {
    const scoped = matterId
      ? persistentAdoptions.filter((item) => item.matterId === matterId)
      : persistentAdoptions;
    const relevantLabels = new Set(scoped.map((item) => item.label));
    const counts = new Map<string, { count: number; matterIds: Set<string>; latestSavedAt?: string }>();
    for (const item of persistentAdoptions) {
      if (matterId && !relevantLabels.has(item.label)) {
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
        .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
        .slice(0, 5),
    };
  }, [persistentAdoptions, matterId]);

  const visiblePersistentAdoptions = useMemo(
    () =>
      persistentAdoptions
        .filter((item) => !matterId || item.matterId === matterId)
        .toSorted((a, b) => b.savedAt.localeCompare(a.savedAt))
        .slice(0, 8),
    [persistentAdoptions, matterId],
  );

  useEffect(() => {
    if (matterId !== prevSelectedMatterForCognitionRef.current) {
      prevSelectedMatterForCognitionRef.current = matterId ?? null;
      setCognitionTaskId(cognitionDefaultTaskId);
      return;
    }
    setCognitionTaskId((prev) => {
      if (!prev) {
        return cognitionDefaultTaskId;
      }
      if (!drafts.some((d) => d.taskId === prev)) {
        return cognitionDefaultTaskId;
      }
      return prev;
    });
  }, [matterId, cognitionDefaultTaskId, drafts]);

  const fetchDraftCognition = useCallback(
    async (taskId: string) => {
      const j = await apiGetJson<{
        ok?: boolean;
        reasoningMarkdown?: string | null;
        memorySources?: MemorySourceLayer[];
        error?: string;
      }>(apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "加载认知面板失败"));
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
        setCognitionError(errorMessage(e, "加载认知面板失败"));
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
            .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
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
              .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
              .slice(0, 6);
          })(),
          upgradeSuggestions: Array.from(layerCounts.entries())
            .map(([label, meta]) => ({ label, count: meta.count, injected: meta.injected }))
            .filter((entry) => !entry.injected && entry.count >= 2)
            .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
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
  }, [cognitionBoardCitationFingerprint, cognitionBoardDrafts, draftCitationByTask, fetchDraftCognition]);

  const cognitionDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;

  useEffect(() => {
    const tid = cognitionTaskId?.trim();
    if (!tid || !apiBase) {
      setCognitionReasoningReport(null);
      return;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      reasoningReport?: import("../../../../../src/lawmind/deliverables/index.ts").ReasoningReport | null;
    }>(apiBase, `/api/drafts/${encodeURIComponent(tid)}`)
      .then((j) => {
        if (!cancelled && j.ok) {
          setCognitionReasoningReport(j.reasoningReport ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCognitionReasoningReport(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, cognitionTaskId]);

  const saveUpgradeSuggestion = useCallback(
    async (
      target: "lawyer" | "assistant",
      item: { label: string; recommendation: string; count: number },
    ) => {
      const currentDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;
      const sourceMatter = matterId ? `来源案件 ${matterId}` : "来源案件未知";
      const sourceDraft = currentDraft ? `观察草稿《${currentDraft.title}》` : "观察草稿未知";
      const note = `${sourceMatter}；${sourceDraft}。认知升级建议：${item.label} 在当前案件关键草稿中命中 ${item.count} 次。${item.recommendation}`;
      const busyKey = `${target}:${item.label}`;
      setCognitionActionBusy(busyKey);
      setCognitionActionMsg(null);
      try {
        const path =
          target === "lawyer" ? "/api/lawyer-profile/learning" : "/api/assistants/profile/learning";
        const requestBody =
          target === "lawyer"
            ? { note, source: "manual" as const }
            : { assistantId: assistantId ?? "default", note };
        const j = await apiSendJson<
          { ok?: boolean; error?: string; message?: string },
          { note: string; source?: string; assistantId?: string }
        >(apiBase, path, "POST", requestBody);
        if (!j.ok) {
          throw new Error(messageFromOkFalseBody(j, "写入失败"));
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
              matterId: matterId,
              taskId: currentDraft?.taskId ?? null,
              draftTitle: currentDraft?.title ?? null,
              savedAt: new Date().toISOString(),
            },
            ...prev,
          ].slice(0, 8),
        );
        void loadPersistentAdoptions();
      } catch (e) {
        setCognitionActionMsg(errorMessage(e, "写入失败"));
      } finally {
        setCognitionActionBusy(null);
      }
    },
    [apiBase, assistantId, cognitionTaskId, drafts, loadPersistentAdoptions, logMatterInteraction, matterId],
  );

  return {
    cognitionReasoningReport,
    cognitionTaskId,
    setCognitionTaskId,
    cognitionDraft,
    cognitionBoardLoading,
    cognitionBoardError,
    cognitionBoard,
    cognitionLoading,
    cognitionError,
    cognitionReasoningMarkdown,
    cognitionMemorySources,
    cognitionActionBusy,
    cognitionActionMsg,
    adoptedSuggestions,
    adoptionHistoryInsight,
    visiblePersistentAdoptions,
    convergenceSuggestions,
    productAdaptationSuggestions,
    productExperimentChecklist,
    crossMatterExperimentBoard,
    roadmapCandidates,
    roadmapPressureSummary,
    handleConvergenceSuggestion,
    saveUpgradeSuggestion,
    pendingDrafts,
    modifiedDrafts,
    approvedDrafts,
  };
}
