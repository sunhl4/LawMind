import type { ArtifactDraft, MatterOverview, MatterSummary } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { MatterWorkspaceAcceptance } from "./useMatterWorkbench";
import { MatterOverviewPanel } from "./MatterOverviewPanel";
import { MatterOpsBrief } from "./MatterOpsBrief";
import { MatterTheoryLitePanel } from "./MatterTheoryLitePanel";
import { MatterQualityCockpit } from "./MatterQualityCockpit";
import { LawmindMatterHealthCard } from "./LawmindMatterHealthCard";
import { useMatterHealthMetrics } from "./useMatterHealthMetrics";
import { type AcceptanceSummaryItem } from "./matter-acceptance-display";
import { MatterLocalDocIndex } from "./MatterLocalDocIndex";
import { MatterOverviewExtras } from "./MatterOverviewExtras";
import { MatterOverviewTodoCards } from "./MatterOverviewTodoCards";
import { MatterProfileCard, type MatterProfilePayload } from "./MatterProfileCard";
import { MatterTeamRosterStrip } from "./MatterTeamRosterStrip";
import { InteractionConvergence, LawyerActionFeed } from "../insights";
import type { ConvergenceHint, InteractionEvent } from "../../../../../src/lawmind/insights/index.ts";
import {
  MatterReviewQueuePanel,
  type ApprovalRow,
  type ReviewQueueRow,
} from "./MatterReviewQueuePanel";
import { formatShortDateTime } from "./matter-display-labels.js";
import { parseMatterInteractionEvent } from "./matter-interaction";
import { useRequireSignoffReview } from "../lawmind-review-prefs";
import { useMatterOverviewViewStore } from "../stores/matter-overview-view-store";
import type {
  AuditEventRow,
  MatterConvergenceSuggestion,
  MatterInteractionSummary,
  MatterRecommendationTarget,
  OperationsFocus,
  OperationsSort,
} from "./matter-interaction";

function toConvergenceHint(item: MatterConvergenceSuggestion): ConvergenceHint {
  return {
    key: item.key,
    title: item.title,
    detail: item.detail,
    actionLabel: item.actionLabel,
    tone: item.tone,
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

export type MatterOverviewBodyProps = {
  apiBase: string;
  matterId: string;
  summary: MatterSummary;
  profile: MatterProfilePayload | null;
  onProfileSaved?: (profile: MatterProfilePayload, statusLine?: string) => void;
  selectedOverview: MatterOverview | null;
  showWorkspaceAcceptanceDashboard: boolean;
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
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
  /** 打开本案「会议室」讨论时间线 */
  onOpenMeeting?: () => void;
  /** 打开本案对话（绑定 matter 上下文） */
  onUseInChat?: (matterId: string) => void;
  /** 打开「在办」待我拍板焦点 */
  onOpenNeedsDecisionDesk?: (
    target?: import("../lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
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
  recentMatterInteractions: AuditEventRow[];
  filteredQueueItems: WorkQueueItem[];
  filteredApprovalRequests: ApprovalRequest[];
  filteredDrafts: ArtifactDraft[];
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
};

function useMatterOverviewViewSelectors() {
  return {
    opsFocus: useMatterOverviewViewStore((s) => s.opsFocus),
    setOpsFocus: useMatterOverviewViewStore((s) => s.setOpsFocus),
    opsSort: useMatterOverviewViewStore((s) => s.opsSort),
    setOpsSort: useMatterOverviewViewStore((s) => s.setOpsSort),
    extrasOpen: useMatterOverviewViewStore((s) => s.extrasOpen),
    openExtras: useMatterOverviewViewStore((s) => s.openExtras),
    closeExtras: useMatterOverviewViewStore((s) => s.closeExtras),
  };
}

export function MatterOverviewBody(props: MatterOverviewBodyProps) {
  const {
    apiBase,
    matterId,
    summary,
    profile,
    onProfileSaved,
    selectedOverview,
    showWorkspaceAcceptanceDashboard,
    workspaceAcceptance,
    workspaceAcceptanceErr,
    reviewSummaryCards,
    onOpenReview,
    openReviewFromMatter,
    onOpenMeeting,
    onUseInChat,
    onOpenNeedsDecisionDesk,
    blockingExplanations,
    handleBlockingAction,
    queueItems,
    approvalRequests,
    matterInteractionSummary,
    showCrossMatterRoadmap,
    convergenceSuggestions,
    handleConvergenceSuggestion,
    recentMatterInteractions,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    draftCitationByTask,
    acceptanceByTask,
  } = props;

  const { opsFocus, setOpsFocus, opsSort, setOpsSort, extrasOpen, openExtras, closeExtras } =
    useMatterOverviewViewSelectors();

  const { metrics: healthMetrics, loading: healthLoading } = useMatterHealthMetrics(
    apiBase,
    matterId,
  );

  const requireSignoffReview = useRequireSignoffReview();
  const pendingReviewCount = reviewSummaryCards.find((c) => c.key === "pending-review")?.count ?? 0;
  const pendingApprovalCount = approvalRequests.filter((a) => a.status === "pending").length;
  const primaryNext = summary.nextActions[0]?.trim() ?? "";
  const railCopy =
    pendingReviewCount > 0
      ? requireSignoffReview
        ? `${pendingReviewCount} 份待审文书可签批`
        : `${pendingReviewCount} 份待审文书可改稿`
      : pendingApprovalCount > 0
        ? `${pendingApprovalCount} 项案件审批待处理`
        : primaryNext || "无紧急待办 — 可在对话下达新任务";
  const extraNextActions = summary.nextActions
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== railCopy);
  const hasTodos =
    blockingExplanations.length > 0 ||
    filteredQueueItems.length > 0 ||
    filteredApprovalRequests.length > 0 ||
    filteredDrafts.length > 0;
  const visibleReviewSummaryCards = reviewSummaryCards.filter((card) => card.count > 0);
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
        <section
          className="lm-matter-decision-rail"
          aria-label="本案下一步"
          data-testid="lm-matter-next-actions"
        >
          <div className="lm-matter-decision-rail-copy">
            <strong>本案下一步</strong>
            <span className="lm-meta">{railCopy}</span>
          </div>
          <div className="lm-matter-decision-rail-actions">
            {onUseInChat ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                data-testid="lm-matter-open-chat"
                onClick={() => onUseInChat(matterId)}
              >
                打开本案对话
              </button>
            ) : null}
            {onOpenNeedsDecisionDesk ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-matter-open-needs-decision"
                onClick={() => onOpenNeedsDecisionDesk?.()}
              >
                待我拍板
              </button>
            ) : null}
            {(() => {
              const pendingCard = reviewSummaryCards.find(
                (c) => c.key === "pending-review" && c.actionTaskId,
              );
              if (!pendingCard?.actionTaskId) {
                return null;
              }
              return (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  data-testid="lm-matter-open-primary-review"
                  onClick={() =>
                    openReviewFromMatter(pendingCard.actionTaskId!, {
                      statusFilter: pendingCard.statusFilter,
                      listMode: pendingCard.listMode,
                      sourceSurface: "overview-decision-rail",
                      sourceLabel: pendingCard.title,
                    })
                  }
                >
                  改稿
                </button>
              );
            })()}
          </div>
          {extraNextActions.length > 0 ? (
            <ul className="lm-bullet-list lm-matter-next-actions-list" data-testid="lm-matter-next-actions">
              {extraNextActions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </section>
        {matterId && healthMetrics && !healthLoading ? (
          <LawmindMatterHealthCard
            matterId={matterId}
            displayName={
              summary.headline?.trim() || selectedOverview?.displayName?.trim() || matterId
            }
            showTitle={false}
            metrics={healthMetrics}
            testId="lm-matter-overview-health-card"
          />
        ) : null}
        <section className="lm-matter-todo-block" data-testid="lm-matter-todos" aria-label="待办">
          <div className="lm-matter-todo-head">
            <h3>待办</h3>
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
                  <option value="delivery">可交付</option>
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
          {blockingExplanations.length > 0 ? (
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
          ) : null}
          {hasTodos ? (
            <MatterOverviewTodoCards
              filteredQueueItems={filteredQueueItems}
              filteredApprovalRequests={filteredApprovalRequests}
              filteredDrafts={filteredDrafts}
              draftCitationByTask={draftCitationByTask}
              onOpenReview={onOpenReview}
              openReviewFromMatter={openReviewFromMatter}
            />
          ) : (
            <p className="lm-meta">无待办 — 可在对话下达新任务</p>
          )}
        </section>
        <MatterOverviewExtras
          expanded={extrasOpen}
          onExpand={() => openExtras()}
          onCollapse={() => closeExtras()}
        >
        {matterId && showWorkspaceAcceptanceDashboard ? (
          <MatterOverviewPanel
            matterId={matterId}
            matterTitle={summary.headline?.trim() || selectedOverview?.displayName?.trim() || matterId}
            matterStatusLabel={summary?.statusLine ?? "—"}
            showDashboard={showWorkspaceAcceptanceDashboard}
            workspaceAcceptance={workspaceAcceptance}
            workspaceAcceptanceErr={workspaceAcceptanceErr}
          />
        ) : null}
        {matterId && apiBase ? <MatterOpsBrief apiBase={apiBase} matterId={matterId} /> : null}
        {matterId && apiBase ? (
          <MatterTeamRosterStrip
            apiBase={apiBase}
            matterId={matterId}
            onOpenMeeting={onOpenMeeting}
            onOpenNeedsDecisionDesk={
              onOpenNeedsDecisionDesk ? () => onOpenNeedsDecisionDesk() : undefined
            }
          />
        ) : null}
        {matterId && apiBase ? <MatterTheoryLitePanel apiBase={apiBase} matterId={matterId} /> : null}
        {matterId && apiBase && profile ? (
          <MatterProfileCard apiBase={apiBase} profile={profile} onSaved={onProfileSaved} />
        ) : null}
        {matterId && apiBase ? <MatterLocalDocIndex apiBase={apiBase} matterId={matterId} /> : null}
        {matterId && showWorkspaceAcceptanceDashboard ? (
          <MatterQualityCockpit
            matterId={matterId}
            enabled
            qualityScore={qualityScore}
            acceptanceReadyCount={acceptanceReadyCount}
            acceptanceBlockedCount={acceptanceBlockedCount}
          />
        ) : null}
        {visibleReviewSummaryCards.length > 0 ? (
        <section className="lm-matter-cockpit-summary">
          {visibleReviewSummaryCards.map((card) => (
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
        ) : null}
        {onOpenMeeting ? (
          <section className="lm-matter-cockpit-card lm-matter-meeting-entry">
            <div className="lm-matter-ops-title">
              <span>本案讨论时间线</span>
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={onOpenMeeting}>
                打开会议室
              </button>
            </div>
          </section>
        ) : null}
        {reviewQueueRows.length > 0 || approvalRows.length > 0 ? (
          <MatterReviewQueuePanel matterId={matterId} queueItems={reviewQueueRows} approvals={approvalRows} />
        ) : null}
        {matterInteractionSummary.total > 0 ? (
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
                    <span className="lm-matter-summary-title">改稿</span>
                    <span className="lm-matter-summary-count">{matterInteractionSummary.reviewOpenCount}</span>
                  </div>
                </div>
                <div className="lm-matter-summary-card lm-matter-summary-card-info">
                  <div className="lm-matter-summary-top">
                    <span className="lm-matter-summary-title">补案件档案</span>
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
        ) : null}
         {showCrossMatterRoadmap && convergenceSuggestions.length > 0 ? (
        <section className="lm-matter-cockpit-card lm-matter-convergence-card">
          <h3>办案建议</h3>
          <InteractionConvergence
            hints={convergenceSuggestions.map(toConvergenceHint)}
            onAction={(hint) => {
              const item = convergenceSuggestions.find((s) => s.key === hint.key);
              if (item) {
                handleConvergenceSuggestion(item);
              }
            }}
          />
        </section>
        ) : null}
        {showCrossMatterRoadmap ? (
          <section className="lm-matter-cockpit-card">
            <h3>最近律师动作</h3>
            <LawyerActionFeed
              events={toInteractionEvents(matterId, recentMatterInteractions)}
              formatRelative={formatShortDateTime}
            />
          </section>
        ) : null}
        {summary.keyRisks.length > 0 ? (
          <section className="lm-matter-cockpit-card">
            <h3>关键风险</h3>
            <ul className="lm-bullet-list">
              {summary.keyRisks.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {summary.recentActivity.length > 0 ? (
          <section className="lm-matter-cockpit-card">
            <h3>近期进展</h3>
            <ul className="lm-bullet-list">
              {summary.recentActivity.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </section>
        ) : null}
        </MatterOverviewExtras>
    </div>
  );
}
