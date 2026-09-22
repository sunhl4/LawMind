/**
 * 案件概览「跨案件实验累积板 / Roadmap 候选池」两张卡（拆自 MatterOverviewBody，纯提取无行为变化）。
 * 产品内省仪器：仅团队自用，律师构建不渲染（见 lawmind-internal-flags）。
 */
import type { ReactNode } from "react";
import type {
  MatterCrossExperimentRollupItem,
  MatterRecommendationTarget,
  MatterRoadmapCandidate,
} from "./matter-interaction";
import { formatShortDateTime } from "./matter-display-labels.js";
import { isInternalExperimentUiEnabled } from "../lawmind-internal-flags";

export type CrossExperimentBoardItem = MatterCrossExperimentRollupItem & {
  includesCurrentMatter?: boolean;
  localSuggestion?: { target: MatterRecommendationTarget };
};

export type RoadmapPressureSummaryView = {
  candidateCount: number;
  nowCount: number;
  validatedCount: number;
  topCandidate: MatterRoadmapCandidate | null;
};

export function MatterCrossExperimentBoardCard(props: {
  items: CrossExperimentBoardItem[];
  onOpenSuggestion: (suggestion: { target: MatterRecommendationTarget }) => void;
}): ReactNode {
  const { items, onOpenSuggestion } = props;
  if (!isInternalExperimentUiEnabled()) {
    return null;
  }
  return (
    <section className="lm-matter-cockpit-card lm-matter-cross-experiment-card">
      <h3>跨案件实验累积板</h3>
      {items.length === 0 ? (
        <p className="lm-meta">暂无</p>
      ) : (
        <ul className="lm-matter-ops-list">
          {items.map((item) => (
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
                        onOpenSuggestion(item.localSuggestion);
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
  );
}

export function MatterRoadmapCandidatesCard(props: {
  candidates: MatterRoadmapCandidate[];
  summary: RoadmapPressureSummaryView;
  onOpenSuggestion: (suggestion: { target: MatterRecommendationTarget }) => void;
}): ReactNode {
  const { candidates, summary, onOpenSuggestion } = props;
  if (!isInternalExperimentUiEnabled()) {
    return null;
  }
  return (
    <section className="lm-matter-cockpit-card lm-matter-roadmap-card">
      <h3>Roadmap 候选池</h3>
      {candidates.length === 0 ? (
        <p className="lm-meta">暂无</p>
      ) : (
        <>
          <div className="lm-matter-roadmap-summary-grid">
            <div className="lm-matter-roadmap-summary-card">
              <span className="lm-meta">候选方向</span>
              <strong>{summary.candidateCount}</strong>
            </div>
            <div className="lm-matter-roadmap-summary-card">
              <span className="lm-meta">现在做</span>
              <strong>{summary.nowCount}</strong>
            </div>
            <div className="lm-matter-roadmap-summary-card">
              <span className="lm-meta">已验证共性</span>
              <strong>{summary.validatedCount}</strong>
            </div>
            <div className="lm-matter-roadmap-summary-card">
              <span className="lm-meta">当前最高压力</span>
              <strong>{summary.topCandidate?.title ?? "暂无"}</strong>
            </div>
          </div>
          <ul className="lm-matter-ops-list">
            {candidates.map((item) => (
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
                        onOpenSuggestion(suggestion);
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
  );
}
