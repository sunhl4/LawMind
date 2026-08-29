/**
 * 案件概览「交互收敛建议 / 产品改造建议」纯函数（拆自 useMatterProductIntelligence，
 * 纯提取无行为变化，便于单测）。
 */
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { CaseFocusContext } from "./matter-case-focus";
import {
  type MatterConvergenceSuggestion,
  type MatterInteractionSummary,
  type MatterProductAdaptationSuggestion,
  matterInteractionSurfaceLabel,
} from "./matter-interaction";

export type SuggestionDerivationInput = {
  matterInteractionSummary: MatterInteractionSummary;
  pendingDrafts: ArtifactDraft[];
  modifiedDrafts: ArtifactDraft[];
  approvedDrafts: ArtifactDraft[];
  drafts: ArtifactDraft[];
  blockingExplanations: Array<{
    actionTab?: "case" | "tasks";
    caseFocusContext?: CaseFocusContext;
  }>;
  caseFocusContext: CaseFocusContext | null;
};

function targetDraftOf(input: SuggestionDerivationInput): ArtifactDraft | undefined {
  return (
    input.pendingDrafts[0] ?? input.modifiedDrafts[0] ?? input.approvedDrafts[0] ?? input.drafts[0]
  );
}

function blockerContextOf(input: SuggestionDerivationInput): CaseFocusContext | undefined {
  return (
    input.blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ??
    input.caseFocusContext ??
    undefined
  );
}

export function buildConvergenceSuggestions(
  input: SuggestionDerivationInput,
): MatterConvergenceSuggestion[] {
  const { matterInteractionSummary } = input;
  const suggestions: MatterConvergenceSuggestion[] = [];

  if (matterInteractionSummary.reviewOpenCount >= 3) {
    const targetDraft = targetDraftOf(input);
    suggestions.push({
      key: "review-loop",
      title: "审核入口仍是主工作面",
      detail:
        "多次从概览去改稿，可把关键审核决策前置到概览。",
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
    suggestions.push({
      key: "case-loop",
      title: "案件档案已成为推进主入口",
      detail: "补结构化案件记录。",
      actionLabel: "回案件档案",
      tone: "info",
      target: { type: "case", context: blockerContextOf(input) },
    });
  }

  if (matterInteractionSummary.memorySaveCount >= 2) {
    suggestions.push({
      key: "memory-loop",
      title: "高频经验值得前置沉淀",
      detail:
        "可升长期记忆。",
      actionLabel: "查看经验升级线索",
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
}

export function buildProductAdaptationSuggestions(
  input: SuggestionDerivationInput,
): MatterProductAdaptationSuggestion[] {
  const { matterInteractionSummary } = input;
  const suggestions: MatterProductAdaptationSuggestion[] = [];

  if (matterInteractionSummary.reviewOpenCount >= 3) {
    const targetDraft = targetDraftOf(input);
    suggestions.push({
      key: "adapt-review-surface",
      title: "把审核决策前置到案件概览",
      detail:
        "多次从概览去改稿，概览可更早露出审核理由与引用状态。",
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
    suggestions.push({
      key: "adapt-case-form",
      title: "为案件档案补录增加结构化表单",
      detail:
        "律师反复回到案件档案补档，说明自由文本入口不够顺手。宜把事实缺口、风险确认、策略目标拆成更显式的结构化输入。",
      actionLabel: "查看当前案件焦点",
      tone: "info",
      target: { type: "case", context: blockerContextOf(input) },
    });
  }

  if (matterInteractionSummary.memorySaveCount >= 2) {
    suggestions.push({
      key: "adapt-memory-fastlane",
      title: "把经验升级做成快捷采纳通道",
      detail:
        "当前案件已经多次把建议写入长期记忆，说明经验沉淀不是偶发动作。下一版适合把高频升级建议做成更靠前的快捷采纳区，而不是藏在认知深层。",
      actionLabel: "查看经验页",
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
}
