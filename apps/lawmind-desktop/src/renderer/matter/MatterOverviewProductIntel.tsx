/**
 * Firm/advanced product-intel cards for matter overview (kept out of daily lawyer path).
 */

import type { ReactNode } from "react";
import {
  InteractionConvergence,
  LawyerActionFeed,
  ProductExperiments,
} from "../insights";
import type {
  ConvergenceHint,
  InteractionEvent,
  ProductExperimentItem,
} from "../../../../../src/lawmind/insights/index.ts";
import { formatShortDateTime } from "./matter-display-labels.js";
import { parseMatterInteractionEvent } from "./matter-interaction";
import type {
  AuditEventRow,
  MatterConvergenceSuggestion,
  MatterCrossExperimentRollupItem,
  MatterProductAdaptationSuggestion,
  MatterProductExperimentItem,
  MatterRecommendationTarget,
  MatterRoadmapCandidate,
} from "./matter-interaction";

function toConvergenceHint(
  item: MatterConvergenceSuggestion | MatterProductAdaptationSuggestion,
): ConvergenceHint {
  return {
    key: item.key,
    title: item.title,
    detail: item.detail,
    actionLabel: item.actionLabel,
    tone: item.tone,
  };
}

function toExperimentItem(item: MatterProductExperimentItem): ProductExperimentItem {
  return {
    key: item.key,
    title: item.title,
    hypothesis: item.hypothesis,
    validation: item.validation,
    signal: item.signal,
    priority: item.priority,
  };
}

function toInteractionEvents(matterId: string, rows: AuditEventRow[]): InteractionEvent[] {
  return rows.map((event) => {
    const parsed = parseMatterInteractionEvent(event);
    return {
      kind: "ui.matter_action" as const,
      matterId,
      taskId: event.taskId ?? "",
      timestamp: event.timestamp ?? "",
      action: parsed.action,
      surface: parsed.surface,
      label: parsed.label ?? event.detail,
    };
  });
}

export type MatterOverviewProductIntelProps = {
  matterId: string;
  convergenceSuggestions: MatterConvergenceSuggestion[];
  productAdaptationSuggestions: MatterProductAdaptationSuggestion[];
  productExperimentChecklist: MatterProductExperimentItem[];
  crossMatterExperimentBoard: Array<
    MatterCrossExperimentRollupItem & {
      includesCurrentMatter?: boolean;
      localSuggestion?: { target: MatterRecommendationTarget };
    }
  >;
  roadmapCandidates: MatterRoadmapCandidate[];
  roadmapPressureSummary: {
    candidateCount: number;
    nowCount: number;
    validatedCount: number;
    topCandidate: MatterRoadmapCandidate | null;
  };
  recentMatterInteractions: AuditEventRow[];
  onSuggest: (item: { target: MatterRecommendationTarget }) => void;
};

export function MatterOverviewProductIntel(props: MatterOverviewProductIntelProps): ReactNode {
  const {
    matterId,
    convergenceSuggestions,
    productAdaptationSuggestions,
    productExperimentChecklist,
    crossMatterExperimentBoard,
    roadmapCandidates,
    roadmapPressureSummary,
    recentMatterInteractions,
    onSuggest,
  } = props;

  return (
    <>
      <section className="lm-matter-cockpit-card lm-matter-convergence-card">
        <h3>交互收敛建议</h3>
        <InteractionConvergence
          hints={convergenceSuggestions.map(toConvergenceHint)}
          onAction={(hint) => {
            const item = convergenceSuggestions.find((s) => s.key === hint.key);
            if (item) {
              onSuggest(item);
            }
          }}
        />
      </section>
      <details className="lm-matter-cockpit-card lm-matter-product-experiments-advanced">
        <summary>产品实验（高级）</summary>
        <section className="lm-matter-product-card">
          <h3>产品改造建议</h3>
          <InteractionConvergence
            hints={productAdaptationSuggestions.map(toConvergenceHint)}
            onAction={(hint) => {
              const item = productAdaptationSuggestions.find((s) => s.key === hint.key);
              if (item) {
                onSuggest(item);
              }
            }}
          />
        </section>
        <section className="lm-matter-experiment-card">
          <h3>产品实验清单</h3>
          <ProductExperiments
            items={productExperimentChecklist.map(toExperimentItem)}
            actionLabelForItem={(it) =>
              productExperimentChecklist.find((s) => s.key === it.key)?.actionLabel ?? "打开对应入口"
            }
            onAction={(it) => {
              const item = productExperimentChecklist.find((s) => s.key === it.key);
              if (item && item.target.type !== "none") {
                onSuggest(item);
              }
            }}
          />
        </section>
        <section className="lm-matter-cross-experiment-card">
          <h3>跨案件实验累积板</h3>
          {crossMatterExperimentBoard.length === 0 ? (
            <p className="lm-meta">暂无</p>
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
                  <div className="lm-matter-ops-meta" title={item.exampleMatterIds.join("、")}>
                    {item.matterCount} 案 · {formatShortDateTime(item.latestAt)}
                    {item.includesCurrentMatter ? " · 含本案" : ""}
                  </div>
                  {item.localSuggestion ? (
                    <div className="lm-matter-ops-actions lm-matter-convergence-actions">
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() => {
                          if (item.localSuggestion) {
                            onSuggest(item.localSuggestion);
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
      </details>
      <section className="lm-matter-cockpit-card lm-matter-roadmap-card">
        <h3>路线图候选</h3>
        {roadmapCandidates.length === 0 ? (
          <p className="lm-meta">暂无</p>
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
                        {item.urgency === "now"
                          ? "现在做"
                          : item.urgency === "next"
                            ? "下一波"
                            : "后续观察"}
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
                      <span className="lm-meta">建议负责人</span>
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
                          onSuggest(suggestion);
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
        <LawyerActionFeed
          events={toInteractionEvents(matterId, recentMatterInteractions)}
          formatRelative={formatShortDateTime}
        />
      </section>
    </>
  );
}
