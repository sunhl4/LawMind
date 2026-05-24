import type { ArtifactDraft, MatterOverview, MatterSummary } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { MatterWorkspaceAcceptance } from "./useMatterWorkbench";
import { MatterOverviewPanel } from "./MatterOverviewPanel";
import { MatterQualityCockpit } from "./MatterQualityCockpit";
import { type AcceptanceSummaryItem } from "./matter-acceptance-display";
import { MatterLocalDocIndex } from "./MatterLocalDocIndex";
import { MatterOverviewExtras } from "./MatterOverviewExtras";
import {
  MatterReviewQueuePanel,
  type ApprovalRow,
  type ReviewQueueRow,
} from "./MatterReviewQueuePanel";
import { DraftCitationBadge } from "./matter-draft-citation-badge";
import {
  approvalStatusLabel,
  formatShortDateTime,
  priorityLabel,
  queueKindLabel,
  reviewStatusLabel,
} from "./matter-display-labels.js";
import { auditKindLabel } from "./matter-interaction";
import type {
  AdoptionHistoryInsight,
  AdoptedSuggestionRecord,
  AuditEventRow,
  MatterConvergenceSuggestion,
  MatterCrossExperimentRollupItem,
  MatterInteractionSummary,
  MatterProductAdaptationSuggestion,
  MatterProductExperimentItem,
  MatterRecommendationTarget,
  MatterRoadmapCandidate,
  OperationsFocus,
  OperationsSort,
} from "./matter-interaction";

export type MatterOverviewBodyProps = {
  apiBase: string;
  matterId: string;
  summary: MatterSummary;
  selectedOverview: MatterOverview | null;
  showWorkspaceAcceptanceDashboard: boolean;
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
  matterOverviewExtrasOpen: boolean;
  setMatterOverviewExtrasOpen: (open: boolean) => void;
  reviewSummaryCards: Array<{
    key: string;
    title: string;
    count: number;
    tone: string;
    hint: string;
    actionLabel: string;
    actionTaskId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }>;
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  openReviewFromMatter: (
    taskId: string,
    opts?: {
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
      sourceSurface?: string;
      sourceLabel?: string;
    },
  ) => void;
  opsFocus: OperationsFocus;
  setOpsFocus: (v: OperationsFocus) => void;
  opsSort: OperationsSort;
  setOpsSort: (v: OperationsSort) => void;
  blockingExplanations: Array<{
    key: string;
    title: string;
    tone: "warn" | "info" | "neutral";
    detail: string;
    count: number;
    actionLabel: string;
    actionTaskId?: string;
    actionTab?: "case" | "tasks";
    caseFocusContext?: import("./matter-case-focus.js").CaseFocusContext;
  }>;
  handleBlockingAction: (item: {
    actionTaskId?: string;
    actionTab?: "case" | "tasks";
    caseFocusContext?: import("./matter-case-focus.js").CaseFocusContext;
  }) => void;
  queueItems: WorkQueueItem[];
  approvalRequests: ApprovalRequest[];
  matterInteractionSummary: MatterInteractionSummary;
  showCrossMatterRoadmap: boolean;
  convergenceSuggestions: MatterConvergenceSuggestion[];
  handleConvergenceSuggestion: (item: { target: MatterRecommendationTarget }) => void;
  productAdaptationSuggestions: MatterProductAdaptationSuggestion[];
  productExperimentChecklist: MatterProductExperimentItem[];
  crossMatterExperimentBoard: Array<
    MatterCrossExperimentRollupItem & { includesCurrentMatter?: boolean; localSuggestion?: { target: MatterRecommendationTarget } }
  >;
  roadmapCandidates: MatterRoadmapCandidate[];
  _adoptionHistoryInsight: AdoptionHistoryInsight;
  _visiblePersistentAdoptions: AdoptedSuggestionRecord[];
  _adoptedSuggestions: AdoptedSuggestionRecord[];
  roadmapPressureSummary: {
    candidateCount: number;
    nowCount: number;
    validatedCount: number;
    topCandidate: MatterRoadmapCandidate | null;
  };
  recentMatterInteractions: AuditEventRow[];
  filteredQueueItems: WorkQueueItem[];
  filteredApprovalRequests: ApprovalRequest[];
  filteredDrafts: ArtifactDraft[];
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
};

export function MatterOverviewBody(props: MatterOverviewBodyProps) {
  const {
    apiBase,
    matterId,
    summary,
    selectedOverview,
    showWorkspaceAcceptanceDashboard,
    workspaceAcceptance,
    workspaceAcceptanceErr,
    matterOverviewExtrasOpen,
    setMatterOverviewExtrasOpen,
    reviewSummaryCards,
    onOpenReview,
    openReviewFromMatter,
    opsFocus,
    setOpsFocus,
    opsSort,
    setOpsSort,
    blockingExplanations,
    handleBlockingAction,
    queueItems,
    approvalRequests,
    matterInteractionSummary,
    showCrossMatterRoadmap,
    convergenceSuggestions,
    handleConvergenceSuggestion,
    productAdaptationSuggestions,
    productExperimentChecklist,
    crossMatterExperimentBoard,
    roadmapCandidates,
    _adoptionHistoryInsight,
    _visiblePersistentAdoptions,
    _adoptedSuggestions,
    roadmapPressureSummary,
    recentMatterInteractions,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    draftCitationByTask,
    acceptanceByTask,
  } = props;

  const acceptanceItems = Object.values(acceptanceByTask).filter(
    (x): x is AcceptanceSummaryItem => Boolean(x),
  );
  const acceptanceReadyCount = acceptanceItems.filter((x) => x.ready).length;
  const acceptanceBlockedCount = acceptanceItems.filter((x) => x.hasSpec && !x.ready).length;
  const qualityScore =
    acceptanceItems.length > 0 ? acceptanceReadyCount / acceptanceItems.length : undefined;

  const reviewQueueRows: ReviewQueueRow[] = queueItems.map((item) => ({
    queueItemId: item.queueItemId,
    title: item.title,
    kind: item.kind,
    priority: item.priority,
    status: item.status,
    updatedAt: item.updatedAt,
  }));
  const approvalRows: ApprovalRow[] = approvalRequests.map((item) => ({
    approvalId: item.approvalId,
    reason: item.reason,
    status: item.status,
    riskLevel: item.riskLevel,
    targetRole: item.targetRole,
    requestedAt: item.requestedAt,
  }));

  return (
    <div className="lm-workbench-panel">
        {matterId ? (
          <MatterOverviewPanel
            matterId={matterId}
            matterTitle={selectedOverview?.displayName?.trim() || matterId}
            matterStatusLabel={summary?.statusLine ?? "—"}
            showDashboard={showWorkspaceAcceptanceDashboard}
            workspaceAcceptance={workspaceAcceptance}
            workspaceAcceptanceErr={workspaceAcceptanceErr}
          />
        ) : null}
        {matterId && apiBase ? <MatterLocalDocIndex apiBase={apiBase} matterId={matterId} /> : null}
        {matterId ? (
          <MatterQualityCockpit
            matterId={matterId}
            enabled={showWorkspaceAcceptanceDashboard}
            qualityScore={qualityScore}
            acceptanceReadyCount={acceptanceReadyCount}
            acceptanceBlockedCount={acceptanceBlockedCount}
          />
        ) : null}
        <section className="lm-matter-cockpit-summary">
          {reviewSummaryCards.map((card) => (
            <div key={card.key} className={`lm-matter-summary-card lm-matter-summary-card-${card.tone}`}>
              <div className="lm-matter-summary-top">
                <span className="lm-matter-summary-title">{card.title}</span>
                <span className="lm-matter-summary-count">{card.count}</span>
              </div>
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
            <p className="lm-meta">无</p>
          ) : (
            <div className="lm-matter-blocking-grid">
              {blockingExplanations.map((item) => (
                <div key={item.key} className={`lm-matter-summary-card lm-matter-summary-card-${item.tone}`}>
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">{item.title}</span>
                    <span className="lm-matter-summary-count">{item.count}</span>
                  </div>
                  <div className="lm-matter-summary-hint">{item.detail}</div>
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
          <MatterReviewQueuePanel matterId={matterId} queueItems={reviewQueueRows} approvals={approvalRows} />
        </section>
         <MatterOverviewExtras
          expanded={matterOverviewExtrasOpen}
          onExpand={() => setMatterOverviewExtrasOpen(true)}
        >
        <section className="lm-matter-cockpit-card lm-matter-behavior-card">
          <h3>律师行为摘要</h3>
          {matterInteractionSummary.total === 0 ? (
            <p className="lm-meta">暂无</p>
          ) : (
            <>
              <div className="lm-matter-cognition-board lm-matter-adoption-board">
                <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">总动作</span>
                    <span className="lm-matter-summary-count">{matterInteractionSummary.total}</span>
                  </div>
                </div>
                <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">进入审核</span>
                    <span className="lm-matter-summary-count">{matterInteractionSummary.reviewOpenCount}</span>
                  </div>
                </div>
                <div className="lm-matter-summary-card lm-matter-summary-card-info">
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">补 CASE</span>
                    <span className="lm-matter-summary-count">{matterInteractionSummary.caseWriteCount}</span>
                  </div>
                </div>
                <div className="lm-matter-summary-card lm-matter-summary-card-success">
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">沉淀记忆</span>
                    <span className="lm-matter-summary-count">{matterInteractionSummary.memorySaveCount}</span>
                  </div>
                </div>
              </div>
              <div className="lm-matter-ops-meta">
                {matterInteractionSummary.dominantActionLabel}
                {matterInteractionSummary.latestAt
                  ? ` · ${formatShortDateTime(matterInteractionSummary.latestAt)}`
                  : ""}
              </div>
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
                        <div className="lm-matter-ops-meta">{item.count} 次</div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </section>
         {showCrossMatterRoadmap ? (
        <>
        <section className="lm-matter-cockpit-card lm-matter-convergence-card">
          <h3>交互收敛建议</h3>
          {convergenceSuggestions.length === 0 ? (
            <p className="lm-meta">暂无</p>
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
          {productAdaptationSuggestions.length === 0 ? (
            <p className="lm-meta">暂无</p>
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
          {productExperimentChecklist.length === 0 ? (
            <p className="lm-meta">暂无</p>
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
        </>
        ) : null}
         <section className="lm-matter-cockpit-card">
          <h3>最近律师动作</h3>
          {recentMatterInteractions.length === 0 ? (
            <p className="lm-meta">暂无</p>
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
              <p className="lm-meta">无</p>
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
              <p className="lm-meta">无</p>
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
              <p className="lm-meta">无</p>
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
         </MatterOverviewExtras>
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
    </div>
  );
}
