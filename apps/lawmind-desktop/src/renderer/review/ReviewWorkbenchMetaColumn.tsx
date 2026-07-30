import type { CSSProperties } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type {
  AcceptanceReport,
  DeliverableReadiness,
  ReasoningReport,
} from "../../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/index.ts";
import type { LearningSuggestionRecord } from "../../../../../src/lawmind/learning/suggestion-queue.ts";
import {
  gateDecisionBadgeClass,
  gateDecisionLabel,
} from "../lawmind-gate-display";
import { ALL_REVIEW_LABELS } from "../../../../../src/lawmind/review-labels.ts";
import { LawmindAcceptanceGate } from "../LawmindAcceptanceGate";
import { LawmindCitationBanner } from "../LawmindCitationBanner";
import { LawmindVerificationChecklist } from "../LawmindVerificationChecklist";
import { LawmindReviewCampaignPanel } from "../LawmindReviewCampaignPanel";
import type { VerificationChecklistView } from "../../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ReviewCampaign } from "../lawmind-review-campaign-api";
import { LawmindReasoningCollapsible } from "../LawmindReasoningCollapsible";
import { LawmindReviewDeliveryBar } from "../LawmindReviewDeliveryBar";
import { LawmindReviewSelfCheckSummary } from "../LawmindReviewSelfCheckSummary";
import { LawmindMemorySourcesPanel } from "../LawmindMemorySourcesPanel";
import { LawmindRedlinePanel } from "../LawmindRedlinePanel";
import { internalIdsTitle, pathBasename } from "../display-ids";
import { reviewStatusDisplayLabel } from "../lawmind-review-display";
import { apiAuthHeaders } from "../lawmind-api-auth";
import { executionStateLabel } from "./review-workbench-helpers";

export type ReviewWorkbenchMetaColumnProps = {
  apiBase: string;
  assistantId: string;
  detail: ArtifactDraft;
  selectedTaskId: string;
  acceptance: AcceptanceReport | null;
  reasoningReport?: ReasoningReport | null;
  /** Serialized LegalReasoningGraph markdown (read-only contention board). */
  reasoningMarkdown?: string | null;
  citationIntegrity: DraftCitationIntegrityView | null;
  /** Firm+ hard-blocks export on citation issues; Solo advisory. */
  citationGateStrict?: boolean;
  /** Skills E4 */
  citationMode?: "grounded" | "assisted" | "off";
  checklistView?: VerificationChecklistView | null;
  checklistChecked?: Record<string, boolean>;
  onChecklistToggle?: (itemId: string, value: boolean) => void;
  checklistBlocksApprove?: boolean;
  readiness?: DeliverableReadiness | null;
  /** Skills E2 */
  campaign?: ReviewCampaign | null;
  onCampaignChange?: (c: ReviewCampaign | null) => void;
  gateDecisions: GateDecision[];
  executionState: TaskExecutionState | null;
  memorySources: MemorySourceLayer[] | null;
  learningQueue: LearningSuggestionRecord[];
  learningBusy: string | null;
  onAdoptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  onDraftUpdated: () => void;
  onGoToChat?: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  /** 文书台 → 在办：正式签批 */
  onOpenAgentsDesk?: () => void;
  deferMemoryWrites: boolean;
  onDeferMemoryWritesChange: (checked: boolean) => void;
  selectedLabels: Set<string>;
  onSelectedLabelsChange: (labels: Set<string>) => void;
  appendToProfile: boolean;
  onAppendToProfileChange: (checked: boolean) => void;
  appendToLawyerProfile: boolean;
  onAppendToLawyerProfileChange: (checked: boolean) => void;
  actionBusy: boolean;
  lastExportPath: string | null;
  onApprove: () => void;
  onReject: () => void;
  onModify: () => void;
  onReopen: () => void;
  onExportWord: (opts?: { strict?: boolean }) => void;
  onExportTrackedWord: () => void;
  onShowArtifact?: (outputPath: string) => void;
  /** Open exported docx with system Word/WPS when Electron bridge is available. */
  onOpenWithSystem?: (outputPath: string) => void | Promise<void>;
  packExportEnabled: boolean;
  onDownloadPack: () => void;
  packBusy: boolean;
  revisionDispatchNote: string;
  onRevisionDispatchNoteChange: (value: string) => void;
  revisionDispatchBusy: boolean;
  onSubmitRevisionJob: () => void;
  actionMsg: string | null;
  note: string;
  onNoteChange: (value: string) => void;
  paneClassName: string;
  paneStyle: CSSProperties;
};

export function ReviewWorkbenchMetaColumn(props: ReviewWorkbenchMetaColumnProps) {
  const {
    apiBase,
    assistantId,
    detail,
    selectedTaskId,
    acceptance,
    reasoningReport = null,
    reasoningMarkdown = null,
    citationIntegrity,
    citationGateStrict,
    citationMode,
    checklistView,
    checklistChecked,
    onChecklistToggle,
    checklistBlocksApprove,
    readiness = null,
    campaign = null,
    onCampaignChange,
    gateDecisions,
    executionState,
    memorySources,
    learningQueue,
    learningBusy,
    onAdoptSuggestion,
    onDismissSuggestion,
    onDraftUpdated,
    onGoToChat,
    onOpenAgentsDesk,
    deferMemoryWrites,
    onDeferMemoryWritesChange,
    selectedLabels,
    onSelectedLabelsChange,
    appendToProfile,
    onAppendToProfileChange,
    appendToLawyerProfile,
    onAppendToLawyerProfileChange,
    actionBusy,
    lastExportPath,
    onApprove,
    onReject,
    onModify,
    onReopen,
    onExportWord,
    onExportTrackedWord,
    onShowArtifact,
    onOpenWithSystem,
    packExportEnabled,
    onDownloadPack,
    packBusy,
    revisionDispatchNote,
    onRevisionDispatchNoteChange,
    revisionDispatchBusy,
    onSubmitRevisionJob,
    actionMsg,
    note,
    onNoteChange,
    paneClassName,
    paneStyle,
  } = props;

  const reviewPending = (detail.reviewStatus ?? "pending") === "pending";

  return (
    <div className={paneClassName} style={paneStyle}>
      <div className="lm-review-meta-pane-scroll lm-review-scroll">
        <div className="lm-workbench-toolbar lm-review-doc-head">
          <div className="lm-review-doc-head-top">
            <h2
              title={internalIdsTitle([
                { label: "任务编号", value: detail.taskId },
                { label: "案件编号", value: detail.matterId ?? undefined },
                { label: "模板编号", value: detail.templateId },
              ])}
            >
              {detail.title}
            </h2>
            <span className="lm-review-status-chip" data-status={detail.reviewStatus ?? "pending"}>
              {reviewStatusDisplayLabel(detail.reviewStatus)}
            </span>
          </div>
          <div className="lm-review-doc-head-actions">
            {onOpenAgentsDesk ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                onClick={onOpenAgentsDesk}
                title="正式通过 / 驳回 / 需修改在「在办」完成"
              >
                回到在办
              </button>
            ) : null}
            {detail.output ? (
              <span className="lm-meta lm-review-doc-head-file" title={detail.output}>
                {pathBasename(detail.output)}
              </span>
            ) : null}
          </div>
        </div>

        <div id="lm-review-citation-banner">
          <LawmindCitationBanner
            view={citationIntegrity}
            apiBase={apiBase}
            taskId={selectedTaskId}
            citationGateStrict={citationGateStrict}
            citationMode={citationMode}
          />
        </div>

        <LawmindReviewDeliveryBar
          reviewStatus={detail.reviewStatus}
          acceptance={acceptance}
          actionBusy={actionBusy}
          lastOutputPath={lastExportPath ?? detail.output ?? null}
          onApprove={onApprove}
          approveDisabled={checklistBlocksApprove}
          onReject={onReject}
          onModify={onModify}
          onReopen={onReopen}
          onExportWord={onExportWord}
          onExportTrackedWord={onExportTrackedWord}
          onShowInFolder={onShowArtifact}
          onOpenWithSystem={onOpenWithSystem}
          packExportEnabled={packExportEnabled}
          onDownloadPack={onDownloadPack}
          packBusy={packBusy}
          variant="writing"
          onOpenAgentsDesk={onOpenAgentsDesk}
          readiness={readiness}
        />

        <LawmindAcceptanceGate
          report={acceptance}
          reasoning={reasoningReport}
          onGoFillInChat={
            onGoToChat
              ? (prompt) =>
                  onGoToChat({
                    taskId: selectedTaskId,
                    matterId: detail.matterId,
                    prompt,
                  })
              : undefined
          }
        />

        {detail.reviewStatus === "modified" ? (
          <div
            className="lm-callout lm-callout-info lm-review-revision-dispatch"
            role="region"
            aria-label="交给助手后台修订"
          >
            <p className="lm-callout-title">交给助手改稿</p>
            <label className="lm-review-note lm-review-revision-dispatch-note">
              <span className="lm-sr-only">发给助手的补充说明</span>
              <textarea
                value={revisionDispatchNote}
                onChange={(e) => onRevisionDispatchNoteChange(e.target.value)}
                placeholder="补充改稿要求（可选）"
                rows={3}
                disabled={revisionDispatchBusy || actionBusy}
              />
            </label>
            <div className="lm-review-revision-dispatch-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent"
                disabled={revisionDispatchBusy || actionBusy}
                onClick={onSubmitRevisionJob}
              >
                {revisionDispatchBusy ? "提交中…" : "提交改稿"}
              </button>
            </div>
          </div>
        ) : null}

        {detail.reviewStatus === "rejected" ? (
          <p className="lm-meta lm-review-next-steps-compact" role="status">
            已驳回 · 需重审时先「恢复待审核」，或回对话说明改法。
          </p>
        ) : null}

        {actionMsg ? (
          <div className="lm-meta lm-review-msg" role="status" aria-live="polite">
            {actionMsg}
          </div>
        ) : null}

        {detail.outputPath && onShowArtifact ? (
          <div className="lm-review-output-row">
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-small"
              onClick={() => onShowArtifact(detail.outputPath!)}
              title={detail.outputPath}
            >
              显示交付文件
            </button>
          </div>
        ) : null}

        <label className="lm-review-note">
          <span className="lm-review-note-title">批注</span>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="批注（可选；在下方「完成签批」或回在办批复时一并提交）"
            rows={3}
            disabled={actionBusy || !reviewPending}
            aria-disabled={actionBusy || !reviewPending}
          />
        </label>

        <details className="lm-review-advanced">
          <summary className="lm-review-advanced-summary">高级</summary>
          <div className="lm-review-advanced-body">
            {reviewPending ? (
              <div className="lm-callout lm-callout-muted" role="region" aria-label="完成签批">
                <p className="lm-callout-title">完成签批（兜底）</p>
                <p className="lm-callout-body">
                  主路径请回「在办」批复。若已在此勾完律师必核、不想跳转，可在此直接通过 / 驳回 /
                  需修改。
                </p>
                <LawmindReviewDeliveryBar
                  reviewStatus={detail.reviewStatus}
                  acceptance={acceptance}
                  actionBusy={actionBusy}
                  lastOutputPath={lastExportPath ?? detail.output ?? null}
                  onApprove={onApprove}
                  approveDisabled={checklistBlocksApprove}
                  onReject={onReject}
                  onModify={onModify}
                  onReopen={onReopen}
                  onExportWord={onExportWord}
                  onExportTrackedWord={onExportTrackedWord}
                  onShowInFolder={onShowArtifact}
                  onOpenWithSystem={onOpenWithSystem}
                  packExportEnabled={packExportEnabled}
                  onDownloadPack={onDownloadPack}
                  packBusy={packBusy}
                  variant="signoff"
                  readiness={readiness}
                />
              </div>
            ) : null}
            {onCampaignChange ? (
              <LawmindReviewCampaignPanel
                apiBase={apiBase}
                taskId={selectedTaskId}
                matterId={detail.matterId}
                campaign={campaign}
                onCampaignChange={onCampaignChange}
              />
            ) : null}
            <LawmindReviewSelfCheckSummary
              acceptance={acceptance}
              citation={citationIntegrity}
              deliverableType={detail.deliverableType}
              gateDecisions={gateDecisions}
            />
            <div className="lm-callout lm-callout-muted" role="status" aria-live="polite">
              <p className="lm-callout-title">执行状态看板</p>
              <p className="lm-callout-body">
                {executionStateLabel(executionState)}
                {executionState?.detail ? ` · ${executionState.detail}` : ""}
              </p>
              {gateDecisions.length > 0 ? (
                <div className="lm-review-gate-list">
                  {gateDecisions.map((gate, idx) => (
                    <span key={`${gate.gate}-${idx}`} className={gateDecisionBadgeClass(gate.decision)}>
                      {gateDecisionLabel(gate.gate)}
                      {gate.reason ? `：${gate.reason}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="lm-callout lm-callout-muted" role="status">
              <p className="lm-callout-title">责任与交付权限</p>
              <p className="lm-callout-body">
                产出助手：{assistantId || "未记录"} · 复核人：
                {detail.reviewedBy?.trim() || "待执业律师确认"} · 对外交付：
                {detail.reviewStatus === "approved"
                  ? `已由 ${detail.reviewedBy?.trim() || "律师"} 批准`
                  : "未授权"}
              </p>
              {detail.reviewStatus !== "approved" ? (
                <p className="lm-meta">生成或渲染不等于批准；未完成律师签批前不得作为定稿对外发送。</p>
              ) : null}
            </div>
            <LawmindRedlinePanel apiBase={apiBase} taskId={selectedTaskId} onDraftUpdated={onDraftUpdated} />
            {learningQueue.length > 0 && (
              <div className="lm-review-learning-queue">
                <div className="lm-review-learning-queue-header">
                  <strong>学习队列</strong>
                  <span className="lm-meta">{learningQueue.length} 条待采纳</span>
                </div>
                <ul className="lm-review-learning-list">
                  {learningQueue.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <span
                        className="lm-meta"
                        title={internalIdsTitle([{ label: "关联草稿任务", value: s.taskId }])}
                      >
                        {s.labels.join("、").trim() || "一条模型生成的升级建议"}
                      </span>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={learningBusy === s.id}
                        onClick={() => onAdoptSuggestion(s.id)}
                      >
                        采纳写回
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={learningBusy === s.id}
                        onClick={() => onDismissSuggestion(s.id)}
                      >
                        忽略
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {memorySources && memorySources.length > 0 ? (
              <LawmindMemorySourcesPanel layers={memorySources} variant="workbench" />
            ) : null}
            {reasoningMarkdown?.trim() ? (
              <>
                <LawmindReasoningCollapsible
                  markdown={reasoningMarkdown}
                  variant="workbench"
                  defaultOpen={false}
                  title="法律推理图（只读争点）"
                />
                <p className="lm-meta">
                  争点板只读；可将摘要采纳到案件「理论」轻量三块（争点/依据）。
                </p>
                {detail.matterId ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    data-testid="lm-adopt-to-theory"
                    onClick={() => {
                      const mid = detail.matterId!.trim();
                      const snippet = (reasoningMarkdown ?? "").trim().slice(0, 2000);
                      void fetch(`${apiBase}/api/matters/${encodeURIComponent(mid)}/theory`, {
                        method: "GET",
                        headers: { accept: "application/json", ...apiAuthHeaders() },
                      })
                        .then((r) => r.json())
                        .then(
                          (cur: {
                            theory?: {
                              issues?: string;
                              authorities?: string;
                              openQuestions?: string;
                              anchored?: boolean;
                            } | null;
                          }) => {
                            const prev = cur.theory;
                            const issues = [
                              prev?.issues?.trim(),
                              snippet ? `【自推理图采纳】\n${snippet}` : "",
                            ]
                              .filter(Boolean)
                              .join("\n\n");
                            return fetch(`${apiBase}/api/matters/${encodeURIComponent(mid)}/theory`, {
                              method: "PUT",
                              headers: { "content-type": "application/json", ...apiAuthHeaders() },
                              body: JSON.stringify({
                                issues,
                                authorities: prev?.authorities ?? "",
                                openQuestions: prev?.openQuestions ?? "",
                                anchored: prev?.anchored ?? false,
                              }),
                            });
                          },
                        )
                        .catch(() => undefined);
                    }}
                  >
                    采纳到理论
                  </button>
                ) : null}
              </>
            ) : null}
            {checklistView && checklistChecked && onChecklistToggle ? (
              <LawmindVerificationChecklist
                view={checklistView}
                checked={checklistChecked}
                onToggle={onChecklistToggle}
                disableApproveHint={checklistBlocksApprove}
              />
            ) : null}
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={deferMemoryWrites}
                onChange={(e) => onDeferMemoryWritesChange(e.target.checked)}
                disabled={actionBusy || !reviewPending}
              />
              <span>学习队列（稍后采纳）</span>
            </label>
            <div className="lm-review-labels">
              <span className="lm-review-labels-title">审核标签（可选，驱动质量学习）</span>
              <div className="lm-review-labels-grid">
                {ALL_REVIEW_LABELS.map((lb) => (
                  <label key={lb} className="lm-review-label-chip">
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(lb)}
                      disabled={actionBusy || !reviewPending}
                      onChange={() => {
                        const next = new Set(selectedLabels);
                        if (next.has(lb)) {
                          next.delete(lb);
                        } else {
                          next.add(lb);
                        }
                        onSelectedLabelsChange(next);
                      }}
                    />
                    <span>{lb}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToProfile}
                disabled={deferMemoryWrites || actionBusy || !reviewPending}
                onChange={(e) => onAppendToProfileChange(e.target.checked)}
              />
              <span>
                将本条审核摘要记入本助手档案（
                <code>{`assistants/${assistantId}/PROFILE.md`}</code>）
              </span>
            </label>
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToLawyerProfile}
                disabled={deferMemoryWrites || actionBusy || !reviewPending}
                onChange={(e) => onAppendToLawyerProfileChange(e.target.checked)}
              />
              <span>
                将本条审核摘要记入工作区律师档案「八、个人积累」（<code>LAWYER_PROFILE.md</code>）
              </span>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
