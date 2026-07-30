/**
 * Matter workbench tab panels — extracted from MatterWorkbenchImpl to keep file size manageable.
 */

import type { RefObject } from "react";
import type { ArtifactDraft, MatterOverview, MatterSummary, TaskRecord } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import { ellipsisText, internalIdsTitle } from "../display-ids";
import type { HistoryItem, TaskRow as ShellTaskRow } from "../lawmind-app-data";
import { MatterTasksPanel } from "./MatterTasksPanel";
import { MatterReviewMatrixPanel } from "./MatterReviewMatrixPanel";
import { MatterTimelinePanel } from "./MatterTimelinePanel";
import { MatterOverviewBody } from "./MatterOverviewBody";
import { MatterCognitionPanel } from "./MatterCognitionPanel";
import { MatterShellRecordsPanel } from "./MatterShellRecordsPanel";
import { MatterWorkbenchTabs } from "./MatterWorkbenchTabs";
import type { useMatterProductIntelligence } from "./useMatterProductIntelligence";
import { MatterCasePanel } from "./MatterCasePanel";
import type { MatterWorkspaceAcceptance } from "../lawmind-query-hooks";
import type { AcceptanceSummaryItem } from "./matter-acceptance-display";
import type { CaseDraftVariant, CaseFocusContext } from "./matter-case-focus";
import type {
  AuditEventRow,
  MatterInteractionSummary,
  OperationsFocus,
  OperationsSort,
} from "./matter-interaction";
import type { TaskBoardJobInput } from "./matter-task-board";
import type { MatterPanelTab } from "./useMatterWorkbench";
import type { SessionTimelineEntry } from "./useMatterSessionTimeline";

type ProductIntelligence = ReturnType<typeof useMatterProductIntelligence>;

type ReviewSummaryCard = {
  key: string;
  title: string;
  count: number;
  tone: "warn" | "info" | "success" | "neutral";
  hint: string;
  actionLabel: string;
  actionTaskId?: string;
  statusFilter: ArtifactDraft["reviewStatus"] | "all";
  listMode: "pending" | "all";
};

export type MatterWorkbenchMainPanelsProps = {
  apiBase: string;
  matterId: string | null;
  assistantId?: string;
  projectDir?: string | null;
  panelTab: MatterPanelTab;
  onSelectPanelTab: (tab: MatterPanelTab) => void;
  /** Jump to top-level「会议室」with this matter scoped. */
  onOpenTopLevelMeeting?: (matterId: string) => void;
  onUseInChat?: (matterId: string) => void;
  onOpenNeedsDecisionDesk?: (
    target?: import("../lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  showShellOps: boolean;
  detailLoading: boolean;
  detailError: string | null;
  summary: MatterSummary | null;
  profile: import("./MatterProfileCard").MatterProfilePayload | null;
  onProfileSaved?: (
    profile: import("./MatterProfileCard").MatterProfilePayload,
    statusLine?: string,
  ) => void;
  selectedOverview: MatterOverview | null;
  showWorkspaceAcceptanceDashboard: boolean;
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
  matterOverviewExtrasOpen: boolean;
  setMatterOverviewExtrasOpen: (open: boolean) => void;
  reviewSummaryCards: ReviewSummaryCard[];
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
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
  opsFocus: OperationsFocus;
  setOpsFocus: (focus: OperationsFocus) => void;
  opsSort: OperationsSort;
  setOpsSort: (sort: OperationsSort) => void;
  blockingExplanations: Array<{
    key: string;
    title: string;
    tone: "warn" | "info" | "neutral";
    detail: string;
    count: number;
    actionLabel: string;
    actionTaskId?: string;
    actionTab?: "case" | "tasks";
    caseFocusContext?: CaseFocusContext;
  }>;
  handleBlockingAction: (item: {
    actionTaskId?: string;
    actionTab?: "case" | "tasks";
    caseFocusContext?: CaseFocusContext;
  }) => void;
  queueItems: WorkQueueItem[];
  approvalRequests: ApprovalRequest[];
  matterInteractionSummary: MatterInteractionSummary;
  showCrossMatterRoadmap: boolean;
  convergenceSuggestions: ProductIntelligence["convergenceSuggestions"];
  handleConvergenceSuggestion: ProductIntelligence["handleConvergenceSuggestion"];
  productAdaptationSuggestions: ProductIntelligence["productAdaptationSuggestions"];
  productExperimentChecklist: ProductIntelligence["productExperimentChecklist"];
  crossMatterExperimentBoard: ProductIntelligence["crossMatterExperimentBoard"];
  roadmapCandidates: ProductIntelligence["roadmapCandidates"];
  adoptionHistoryInsight: ProductIntelligence["adoptionHistoryInsight"];
  visiblePersistentAdoptions: ProductIntelligence["visiblePersistentAdoptions"];
  adoptedSuggestions: ProductIntelligence["adoptedSuggestions"];
  roadmapPressureSummary: ProductIntelligence["roadmapPressureSummary"];
  recentMatterInteractions: AuditEventRow[];
  filteredQueueItems: WorkQueueItem[];
  filteredApprovalRequests: ApprovalRequest[];
  filteredDrafts: ArtifactDraft[];
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  acceptanceByTask: Record<string, AcceptanceSummaryItem>;
  caseFocusContext: CaseFocusContext | null;
  caseDraftVariant: CaseDraftVariant;
  caseDraftNote: string;
  caseActionBusy: boolean;
  caseActionMsg: string | null;
  searchQ: string;
  searchBusy: boolean;
  searchHits: import("./matter-interaction").MatterSearchHit[];
  searchIndexMissing: boolean;
  coreIssues: string[];
  riskNotes: string[];
  artifacts: string[];
  caseMemory: string;
  caseTruncated: boolean;
  coreIssuesRef: RefObject<HTMLHeadingElement | null>;
  riskNotesRef: RefObject<HTMLHeadingElement | null>;
  artifactsRef: RefObject<HTMLHeadingElement | null>;
  caseMdRef: RefObject<HTMLHeadingElement | null>;
  onClearCaseFocus: () => void;
  onCaseDraftVariantChange: (variant: CaseDraftVariant) => void;
  onCaseDraftNoteChange: (note: string) => void;
  onSearchQueryChange: (q: string) => void;
  onRunSearch: () => void;
  onWriteCaseFocusNote: () => void;
  tasks: TaskRecord[];
  drafts: ArtifactDraft[];
  matterJobs: TaskBoardJobInput[];
  onOpenWorkflowLibrary?: () => void;
  onOpenChatSession?: (sessionId: string, matterId?: string) => void;
  progressEntries: string[];
  sessionTimeline: SessionTimelineEntry[];
  auditEvents: AuditEventRow[];
  productIntelligence: Pick<
    ProductIntelligence,
    | "cognitionReasoningReport"
    | "cognitionTaskId"
    | "setCognitionTaskId"
    | "cognitionDraft"
    | "cognitionBoardLoading"
    | "cognitionBoardError"
    | "cognitionBoard"
    | "cognitionLoading"
    | "cognitionError"
    | "cognitionReasoningMarkdown"
    | "cognitionMemorySources"
    | "cognitionActionBusy"
    | "cognitionActionMsg"
    | "saveUpgradeSuggestion"
  >;
  shellTasksScoped: ShellTaskRow[];
  shellHistoryScoped: HistoryItem[];
  shellAssistantDisplayById: Record<string, string>;
  shellLegalStatusLabel?: (status: string | undefined, kind?: string) => string;
  shellTaskBadgeClass?: (status: string, kind?: string) => string;
  shellHistoryBadgeClass?: (kind: string, taskRecordKind?: string, status?: string) => string;
  formatShellRelativeTime?: (iso: string) => string;
  onOpenShellDetail?: (kind: "task" | "draft", id: string) => void;
  isUnlinkedBucket: boolean;
  onSelectPanelTabUnlinked: (tab: "ledger" | "deliveries") => void;
};

export function MatterWorkbenchMainPanels(props: MatterWorkbenchMainPanelsProps) {
  const {
    apiBase,
    matterId,
    panelTab,
    onSelectPanelTab,
    onOpenTopLevelMeeting,
    onUseInChat,
    onOpenNeedsDecisionDesk,
    showShellOps,
    detailLoading,
    detailError,
    summary,
    profile,
    onProfileSaved,
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
    adoptionHistoryInsight,
    visiblePersistentAdoptions,
    adoptedSuggestions,
    roadmapPressureSummary,
    recentMatterInteractions,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    draftCitationByTask,
    acceptanceByTask,
    caseFocusContext,
    caseDraftVariant,
    caseDraftNote,
    caseActionBusy,
    caseActionMsg,
    searchQ,
    searchBusy,
    searchHits,
    searchIndexMissing,
    coreIssues,
    riskNotes,
    artifacts,
    caseMemory,
    caseTruncated,
    coreIssuesRef,
    riskNotesRef,
    artifactsRef,
    caseMdRef,
    onClearCaseFocus,
    onCaseDraftVariantChange,
    onCaseDraftNoteChange,
    onSearchQueryChange,
    onRunSearch,
    onWriteCaseFocusNote,
    tasks,
    drafts,
    matterJobs,
    onOpenWorkflowLibrary,
    onOpenChatSession,
    progressEntries,
    sessionTimeline,
    auditEvents,
    productIntelligence,
    shellTasksScoped,
    shellHistoryScoped,
    shellAssistantDisplayById,
    shellLegalStatusLabel,
    shellTaskBadgeClass,
    shellHistoryBadgeClass,
    formatShellRelativeTime,
    onOpenShellDetail,
    isUnlinkedBucket,
    onSelectPanelTabUnlinked,
  } = props;

  const {
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
    saveUpgradeSuggestion,
  } = productIntelligence;

  if (isUnlinkedBucket && showShellOps) {
    return (
      <>
        <div className="lm-workbench-toolbar">
          <div className="lm-workbench-title-block">
            <h2>未关联案件</h2>
            <p className="lm-meta">下列任务与交付尚未关联案件编号，建议在工作台中归入具体案件。</p>
          </div>
        </div>
        <div className="lm-tabs lm-workbench-tabs" role="tablist" aria-label="未关联案件记录">
          <button
            type="button"
            role="tab"
            id="lm-matter-unlinked-tab-ledger"
            aria-selected={panelTab === "ledger"}
            aria-controls="lm-matter-unlinked-panel"
            tabIndex={panelTab === "ledger" ? 0 : -1}
            className={`lm-tab ${panelTab === "ledger" ? "active" : ""}`}
            onClick={() => onSelectPanelTabUnlinked("ledger")}
          >
            任务台帐
          </button>
          <button
            type="button"
            role="tab"
            id="lm-matter-unlinked-tab-deliveries"
            aria-selected={panelTab === "deliveries"}
            aria-controls="lm-matter-unlinked-panel"
            tabIndex={panelTab === "deliveries" ? 0 : -1}
            className={`lm-tab ${panelTab === "deliveries" ? "active" : ""}`}
            onClick={() => onSelectPanelTabUnlinked("deliveries")}
          >
            交付记录
          </button>
        </div>
        <div
          role="tabpanel"
          id="lm-matter-unlinked-panel"
          aria-labelledby={`lm-matter-unlinked-tab-${panelTab}`}
          tabIndex={0}
        >
        {panelTab === "ledger" && (
          <MatterShellRecordsPanel
            mode="ledger"
            shellTasksScoped={shellTasksScoped}
            shellHistoryScoped={shellHistoryScoped}
            shellAssistantDisplayById={shellAssistantDisplayById}
            shellLegalStatusLabel={shellLegalStatusLabel}
            shellTaskBadgeClass={shellTaskBadgeClass}
            shellHistoryBadgeClass={shellHistoryBadgeClass}
            formatShellRelativeTime={formatShellRelativeTime}
            onOpenShellDetail={onOpenShellDetail}
          />
        )}
        {panelTab === "deliveries" && (
          <MatterShellRecordsPanel
            mode="deliveries"
            shellTasksScoped={shellTasksScoped}
            shellHistoryScoped={shellHistoryScoped}
            shellAssistantDisplayById={shellAssistantDisplayById}
            shellLegalStatusLabel={shellLegalStatusLabel}
            shellTaskBadgeClass={shellTaskBadgeClass}
            shellHistoryBadgeClass={shellHistoryBadgeClass}
            formatShellRelativeTime={formatShellRelativeTime}
            onOpenShellDetail={onOpenShellDetail}
          />
        )}
        </div>
      </>
    );
  }

  if (detailLoading) {
    return <div className="lm-meta" aria-busy="true" aria-label="加载案件详情">加载案件详情…</div>;
  }
  if (detailError) {
    return (
      <div className="lm-callout lm-callout-danger" role="alert">
        <p className="lm-callout-body">{detailError}</p>
      </div>
    );
  }
  if (!summary || !matterId) {
    return null;
  }

  return (
    <>
      <div className="lm-workbench-toolbar">
        <div className="lm-workbench-title-block">
          <h2 title={internalIdsTitle([{ label: "案件编号", value: matterId }])}>
            {summary.headline?.trim() ? ellipsisText(summary.headline, 72) : "案件工作台"}
          </h2>
        </div>
      </div>

      <MatterWorkbenchTabs panelTab={panelTab} onSelect={onSelectPanelTab} showShellOps={showShellOps} />

      <div
        role="tabpanel"
        id={`lm-matter-panel-${panelTab}`}
        aria-labelledby={`lm-matter-tab-${panelTab}`}
        tabIndex={0}
      >
      {panelTab === "overview" && (
        <MatterOverviewBody
          apiBase={apiBase}
          matterId={matterId}
          summary={summary}
          profile={profile}
          onProfileSaved={onProfileSaved}
          selectedOverview={selectedOverview}
          showWorkspaceAcceptanceDashboard={showWorkspaceAcceptanceDashboard}
          workspaceAcceptance={workspaceAcceptance}
          workspaceAcceptanceErr={workspaceAcceptanceErr}
          matterOverviewExtrasOpen={matterOverviewExtrasOpen}
          setMatterOverviewExtrasOpen={setMatterOverviewExtrasOpen}
          reviewSummaryCards={reviewSummaryCards}
          onOpenReview={onOpenReview}
          openReviewFromMatter={openReviewFromMatter}
          onOpenMeeting={
            matterId && onOpenTopLevelMeeting
              ? () => onOpenTopLevelMeeting(matterId)
              : undefined
          }
          onUseInChat={onUseInChat}
          onOpenNeedsDecisionDesk={onOpenNeedsDecisionDesk}
          opsFocus={opsFocus}
          setOpsFocus={setOpsFocus}
          opsSort={opsSort}
          setOpsSort={setOpsSort}
          blockingExplanations={blockingExplanations}
          handleBlockingAction={handleBlockingAction}
          queueItems={queueItems}
          approvalRequests={approvalRequests}
          matterInteractionSummary={matterInteractionSummary}
          showCrossMatterRoadmap={showCrossMatterRoadmap}
          convergenceSuggestions={convergenceSuggestions}
          handleConvergenceSuggestion={handleConvergenceSuggestion}
          productAdaptationSuggestions={productAdaptationSuggestions}
          productExperimentChecklist={productExperimentChecklist}
          crossMatterExperimentBoard={crossMatterExperimentBoard}
          roadmapCandidates={roadmapCandidates}
          roadmapPressureSummary={roadmapPressureSummary}
          recentMatterInteractions={recentMatterInteractions}
          filteredQueueItems={filteredQueueItems}
          filteredApprovalRequests={filteredApprovalRequests}
          filteredDrafts={filteredDrafts}
          draftCitationByTask={draftCitationByTask}
          acceptanceByTask={acceptanceByTask}
        />
      )}

      {panelTab === "case" && (
        <MatterCasePanel
          caseFocusContext={caseFocusContext}
          caseDraftVariant={caseDraftVariant}
          caseDraftNote={caseDraftNote}
          caseActionBusy={caseActionBusy}
          caseActionMsg={caseActionMsg}
          searchQ={searchQ}
          searchBusy={searchBusy}
          searchHits={searchHits}
          searchIndexMissing={searchIndexMissing}
          coreIssues={coreIssues}
          riskNotes={riskNotes}
          artifacts={artifacts}
          caseMemory={caseMemory}
          caseTruncated={caseTruncated}
          coreIssuesRef={coreIssuesRef}
          riskNotesRef={riskNotesRef}
          artifactsRef={artifactsRef}
          caseMdRef={caseMdRef}
          onClearCaseFocus={onClearCaseFocus}
          onCaseDraftVariantChange={onCaseDraftVariantChange}
          onCaseDraftNoteChange={onCaseDraftNoteChange}
          onSearchQueryChange={onSearchQueryChange}
          onRunSearch={onRunSearch}
          onWriteCaseFocusNote={onWriteCaseFocusNote}
        />
      )}

      {panelTab === "tasks" && (
        <MatterTasksPanel
          apiBase={apiBase}
          matterId={matterId}
          tasks={tasks}
          drafts={drafts}
          queueItems={queueItems}
          approvalRequests={approvalRequests}
          acceptanceByTask={acceptanceByTask}
          draftCitationByTask={draftCitationByTask}
          onOpenReview={onOpenReview}
          onOpenWorkflowLibrary={onOpenWorkflowLibrary}
          onOpenChatSession={onOpenChatSession}
          onOpenNeedsDecision={
            onOpenNeedsDecisionDesk ? () => onOpenNeedsDecisionDesk() : undefined
          }
          jobs={matterJobs}
        />
      )}

      {panelTab === "matrix" && matterId ? (
        <MatterReviewMatrixPanel apiBase={apiBase} matterId={matterId} onOpenReview={onOpenReview} />
      ) : null}

      {panelTab === "timeline" && (
        <MatterTimelinePanel
          progressEntries={progressEntries}
          sessionTimeline={sessionTimeline}
          auditEvents={auditEvents}
        />
      )}

      {panelTab === "cognition" && (
        <MatterCognitionPanel
          apiBase={apiBase}
          matterId={matterId}
          reasoningReport={cognitionReasoningReport}
          drafts={drafts}
          cognitionTaskId={cognitionTaskId}
          setCognitionTaskId={setCognitionTaskId}
          cognitionDraft={cognitionDraft}
          cognitionBoardLoading={cognitionBoardLoading}
          cognitionBoardError={cognitionBoardError}
          cognitionBoard={cognitionBoard}
          cognitionLoading={cognitionLoading}
          cognitionError={cognitionError}
          cognitionReasoningMarkdown={cognitionReasoningMarkdown}
          cognitionMemorySources={cognitionMemorySources}
          cognitionActionBusy={cognitionActionBusy}
          cognitionActionMsg={cognitionActionMsg}
          draftCitationByTask={draftCitationByTask}
          adoptionHistoryInsight={adoptionHistoryInsight}
          visiblePersistentAdoptions={visiblePersistentAdoptions}
          adoptedSuggestions={adoptedSuggestions}
          saveUpgradeSuggestion={saveUpgradeSuggestion}
          onOpenReview={onOpenReview}
          openReviewFromMatter={openReviewFromMatter}
        />
      )}

      {showShellOps && panelTab === "ledger" && (
        <MatterShellRecordsPanel
          mode="ledger"
          shellTasksScoped={shellTasksScoped}
          shellHistoryScoped={shellHistoryScoped}
          shellAssistantDisplayById={shellAssistantDisplayById}
          shellLegalStatusLabel={shellLegalStatusLabel}
          shellTaskBadgeClass={shellTaskBadgeClass}
          shellHistoryBadgeClass={shellHistoryBadgeClass}
          formatShellRelativeTime={formatShellRelativeTime}
          onOpenShellDetail={onOpenShellDetail}
        />
      )}

      {showShellOps && panelTab === "deliveries" && (
        <MatterShellRecordsPanel
          mode="deliveries"
          shellTasksScoped={shellTasksScoped}
          shellHistoryScoped={shellHistoryScoped}
          shellAssistantDisplayById={shellAssistantDisplayById}
          shellLegalStatusLabel={shellLegalStatusLabel}
          shellTaskBadgeClass={shellTaskBadgeClass}
          shellHistoryBadgeClass={shellHistoryBadgeClass}
          formatShellRelativeTime={formatShellRelativeTime}
          onOpenShellDetail={onOpenShellDetail}
        />
      )}
      </div>
    </>
  );
}
