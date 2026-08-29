/**
 * 在办右栏办理区：签批 / 补充 / 批准仪式 + 导出条。
 */
import type { ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";
import { LawmindVerificationChecklist } from "./LawmindVerificationChecklist";
import { LawmindApprovalDocReader } from "./LawmindApprovalDocReader";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";
import {
  checkAllRequiredChecklistItems,
  type VerificationChecklistView,
} from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ApprovalDocumentPreview } from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import {
  fleetStatusKind as statusKind,
  fleetStatusLabel as statusLabel,
} from "./lawmind-fleet-queue";
import type { PostApproveExportState } from "./lawmind-post-approve-export";
import { LawmindFleetPostApproveBar } from "./LawmindFleetPostApproveBar";

export type LawmindAgentFleetDetailProps = {
  listMode: "team" | "queue";
  current: AgentRunSummary | null;
  displayTitle: string;
  matterLabelById?: Record<string, string>;
  assistantDisplayById?: Record<string, string>;
  readingMode: boolean;
  approvalDoc: ApprovalDocumentPreview | null;
  isDraftReview: boolean;
  showForm: boolean;
  allActions: LawMindRequiresAction[];
  sessionId?: string;
  clarificationDraft: Record<string, string>;
  onClarificationDraftChange: (key: string, value: string) => void;
  deskChecklistView: VerificationChecklistView | null;
  deskChecklistChecked: Record<string, boolean>;
  deskChecklistLoading: boolean;
  deskChecklistComplete: boolean;
  /** 验收未过时禁用一键勾选，避免未过目即齐。 */
  deskAcceptanceReady?: boolean;
  onDeskChecklistCheckedChange: (next: Record<string, boolean>) => void;
  onClearError: () => void;
  busy: boolean;
  primaryLabel: string;
  /** Dock secondary for awaiting_approval — 先停在这里 when continue_tools. */
  rejectLabel?: string;
  primaryDisabled: boolean;
  clarifyComplete: boolean;
  onPrimary: () => void;
  onDraftReview: (status: "approved" | "rejected" | "modified") => void;
  /** Remove unapproved draft from 在办 / 文书台. */
  onDiscardPendingDraft?: () => void;
  onRejectApproval: () => void;
  onSnooze: () => void;
  approvalAction: LawMindRequiresAction | null;
  approvalIsDocWrite: boolean;
  approvalLinkedTaskId: string | null;
  showArgsEdit: boolean;
  argsEditOpen: boolean;
  argsEditError: string | null;
  onArgsEditOpenChange: (open: boolean) => void;
  onArgsEditErrorChange: (err: string | null) => void;
  onApproveTool: (action: LawMindRequiresAction) => void;
  onApproveToolEdit: (action: LawMindRequiresAction, edited: Record<string, unknown>) => void;
  onRejectTool: (action: LawMindRequiresAction) => void;
  onRespondClarification: (action: LawMindRequiresAction) => void;
  onResolveMatterApproval: (
    action: LawMindRequiresAction,
    status: "approved" | "rejected",
  ) => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  postApproveExport: PostApproveExportState | null;
  workspaceDir?: string;
  onPostApproveExport: () => void;
  onPostApproveTrackedExport?: () => void | Promise<void>;
  trackedExportBusy?: boolean;
  onPostApproveDismiss: () => void;
  onShowArtifact?: (outputPath: string) => void;
  onOpenError: (message: string) => void;
  onOpenHealth?: () => void;
  onSaveAsAutomation?: () => void;
  saveAsAutomationBusy?: boolean;
  saveAsAutomationHint?: string | null;
};

export function LawmindAgentFleetDetail(props: LawmindAgentFleetDetailProps): ReactNode {
  const {
    listMode,
    current,
    displayTitle,
    matterLabelById = {},
    assistantDisplayById = {},
    readingMode,
    approvalDoc,
    isDraftReview,
    showForm,
    allActions,
    sessionId,
    clarificationDraft,
    onClarificationDraftChange,
    deskChecklistView,
    deskChecklistChecked,
    deskChecklistLoading,
    deskChecklistComplete,
    deskAcceptanceReady = true,
    onDeskChecklistCheckedChange,
    onClearError,
    busy,
    primaryLabel,
    rejectLabel = "驳回",
    primaryDisabled,
    clarifyComplete,
    onPrimary,
    onDraftReview,
    onDiscardPendingDraft,
    onRejectApproval,
    onSnooze,
    approvalAction,
    approvalIsDocWrite,
    approvalLinkedTaskId,
    showArgsEdit,
    argsEditOpen,
    argsEditError,
    onArgsEditOpenChange,
    onArgsEditErrorChange,
    onApproveTool,
    onApproveToolEdit,
    onRejectTool,
    onRespondClarification,
    onResolveMatterApproval,
    onOpenChatSession,
    onOpenReview,
    postApproveExport,
    workspaceDir,
    onPostApproveExport,
    onPostApproveTrackedExport,
    trackedExportBusy = false,
    onPostApproveDismiss,
    onShowArtifact,
    onOpenError,
    onOpenHealth,
    onSaveAsAutomation,
    saveAsAutomationBusy,
    saveAsAutomationHint,
  } = props;

  return (
    <section
      className={`lm-agents-wb-detail${readingMode ? " lm-agents-wb-detail--reading" : ""}`}
      aria-label="办理区"
    >
      {!current ? (
        <div className="lm-agents-wb-detail-empty" data-testid="lm-fleet-pick-hint">
          <h2>{listMode === "team" ? "从左侧打开待办" : "选择事项"}</h2>
          <p className="lm-meta">点一位同事或切到「队列」，办理区会打开对应待拍板。</p>
        </div>
      ) : (
        <>
          <header className="lm-agents-wb-detail-head">
            <div className="lm-agents-wb-detail-head-row">
              <span className="lm-agents-wb-kicker" data-kind={statusKind(current.status)}>
                {statusLabel(current.status)}
              </span>
              {!readingMode && current.matterId && !current.matterId.startsWith("临时") ? (
                <span
                  className="lm-agents-wb-detail-meta-inline"
                  title={current.matterId}
                >
                  案件 {matterLabelById[current.matterId]?.trim() || current.matterId}
                  {current.assistantId
                    ? ` · ${assistantDisplayById[current.assistantId]?.trim() || current.assistantId}`
                    : ""}
                </span>
              ) : null}
            </div>
            <h2>{displayTitle.replace(/^待审定：\s*/, "")}</h2>
          </header>

          {readingMode && approvalDoc ? (
            <LawmindApprovalDocReader doc={approvalDoc} showTitle={false} />
          ) : (
            <div className="lm-agents-wb-detail-scroll">
              <div
                className={`lm-agents-wb-detail-inner${
                  current.status === "awaiting_clarification"
                    ? " lm-agents-wb-detail-inner--form"
                    : ""
                }`}
              >
                {isDraftReview ? (
                  <div className="lm-agents-wb-block" id="lm-fleet-panel-actions" data-testid="lm-fleet-draft-hint">
                    {deskChecklistLoading ? (
                      <p className="lm-meta" aria-busy="true">
                        加载必核清单…
                      </p>
                    ) : deskChecklistView ? (
                      <div className="lm-fleet-desk-checklist" data-testid="lm-fleet-desk-checklist">
                        <div className="lm-fleet-desk-checklist-actions">
                          <button
                            type="button"
                            className="lm-btn lm-btn-accent lm-btn-sm"
                            data-testid="lm-fleet-checklist-check-all"
                            disabled={
                              busy ||
                              deskChecklistLoading ||
                              deskChecklistComplete ||
                              !deskAcceptanceReady
                            }
                            aria-disabled={
                              busy ||
                              deskChecklistLoading ||
                              deskChecklistComplete ||
                              !deskAcceptanceReady
                            }
                            title={
                              !deskAcceptanceReady
                                ? "验收未过，请逐项过目"
                                : deskChecklistComplete
                                  ? "必核项已全部勾选"
                                  : "一键勾选全部必核"
                            }
                            onClick={() => {
                              onDeskChecklistCheckedChange(
                                checkAllRequiredChecklistItems(
                                  deskChecklistView,
                                  deskChecklistChecked,
                                ),
                              );
                              onClearError();
                            }}
                          >
                            一键勾选必核
                          </button>
                          <span className="lm-meta">请逐项过目</span>
                        </div>
                        <LawmindVerificationChecklist
                          view={deskChecklistView}
                          checked={deskChecklistChecked}
                          onToggle={(id, value) =>
                            onDeskChecklistCheckedChange({
                              ...deskChecklistChecked,
                              [id]: value,
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ) : showForm ? (
                  <div
                    className={`lm-agents-wb-block${
                      current.status === "awaiting_clarification"
                        ? " lm-agents-wb-block--form"
                        : ""
                    }`}
                    id="lm-fleet-panel-actions"
                  >
                    <LawmindRequiresActionCard
                      actions={allActions}
                      sessionId={current.sessionId ?? sessionId}
                      clarificationDraft={clarificationDraft}
                      onClarificationDraftChange={onClarificationDraftChange}
                      onApproveTool={onApproveTool}
                      onApproveToolEdit={onApproveToolEdit}
                      onRejectTool={onRejectTool}
                      onRespondClarification={onRespondClarification}
                      onResolveMatterApproval={onResolveMatterApproval}
                      onOpenReview={onOpenReview}
                      busy={busy}
                      hideActions
                      clarificationVariant="desk"
                    />
                  </div>
                ) : (
                  <div id="lm-fleet-panel-actions" hidden />
                )}
              </div>
            </div>
          )}

          <footer className="lm-agents-wb-dock">
            <button
              type="button"
              className="lm-btn lm-btn-accent"
              data-testid={
                isDraftReview
                  ? "lm-fleet-draft-approve"
                  : approvalAction?.kind === "continue_tools"
                    ? "lm-continue-tools-approve"
                    : "lm-ceremony-primary"
              }
              disabled={primaryDisabled}
              title={
                current.status === "awaiting_clarification" && !clarifyComplete
                  ? "请先填完必填项"
                  : isDraftReview && !deskChecklistComplete
                    ? "请先完成律师必核清单"
                    : undefined
              }
              onClick={onPrimary}
            >
              {primaryLabel}
            </button>
            {isDraftReview ? (
              <>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={busy}
                  data-testid="lm-fleet-draft-modify"
                  onClick={() => onDraftReview("modified")}
                  title="标为需修改后打开改稿或派发助手修订"
                >
                  需修改
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  data-testid="lm-fleet-primary-review"
                  disabled={busy}
                  onClick={() => onOpenReview?.(current.taskId, current.matterId)}
                  title="改稿、批注与交付预览；正式批复仍在本页签批"
                >
                  改稿
                </button>
                <details className="lm-fleet-dock-more" data-testid="lm-fleet-draft-more">
                  <summary className="lm-btn lm-btn-ghost">更多</summary>
                  <div className="lm-fleet-dock-more-menu">
                    <button
                      type="button"
                      className="lm-btn lm-btn-secondary"
                      disabled={busy}
                      data-testid="lm-fleet-draft-reject"
                      onClick={() => onDraftReview("rejected")}
                    >
                      驳回
                    </button>
                    {onDiscardPendingDraft ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost"
                        data-testid="lm-fleet-discard-pending-draft"
                        disabled={busy}
                        onClick={() => onDiscardPendingDraft()}
                        title="丢弃此待签批草稿（不经过通过/驳回）"
                      >
                        丢弃待签批
                      </button>
                    ) : null}
                  </div>
                </details>
              </>
            ) : current.status === "awaiting_approval" && approvalAction ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                data-testid={
                  approvalAction.kind === "continue_tools" ? "lm-continue-tools-stop" : undefined
                }
                disabled={busy}
                onClick={() => onRejectApproval()}
              >
                {rejectLabel}
              </button>
            ) : (
              <button type="button" className="lm-btn lm-btn-ghost" onClick={() => onSnooze()}>
                稍后
              </button>
            )}
            {current.status === "awaiting_approval" &&
            approvalAction?.kind === "tool_approval" &&
            approvalIsDocWrite &&
            approvalLinkedTaskId &&
            onOpenReview ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost"
                disabled={busy}
                data-testid="lm-fleet-approval-open-review"
                onClick={() => onOpenReview(approvalLinkedTaskId, current.matterId)}
                title="改稿、批注与交付预览"
              >
                改稿
              </button>
            ) : null}
            {current.status === "awaiting_approval" && showArgsEdit ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost"
                disabled={busy}
                data-testid="lm-ceremony-edit-args"
                onClick={() => {
                  onArgsEditErrorChange(null);
                  onArgsEditOpenChange(true);
                }}
                title={
                  approvalIsDocWrite ? "仅改标题等短字段；全文请改稿" : "调整短字段后批准"
                }
              >
                {approvalIsDocWrite ? "改参数…" : "改拟稿…"}
              </button>
            ) : null}
            {current.sessionId && current.status !== "awaiting_clarification" ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost"
                onClick={() =>
                  onOpenChatSession(current.sessionId!, current.matterId, current.assistantId)
                }
              >
                相关对话
              </button>
            ) : null}
          </footer>

          <LawmindToolArgsEditDialog
            open={argsEditOpen && approvalAction?.kind === "tool_approval"}
            toolArgs={approvalAction?.kind === "tool_approval" ? approvalAction.toolArgs : null}
            busy={busy}
            error={argsEditError}
            matterId={current.matterId}
            onOpenReview={onOpenReview}
            onCancel={() => {
              onArgsEditOpenChange(false);
              onArgsEditErrorChange(null);
            }}
            onApprove={(edited) => {
              if (!approvalAction || approvalAction.kind !== "tool_approval") {
                return;
              }
              onArgsEditErrorChange(null);
               onApproveToolEdit(approvalAction, edited);
            }}
          />
        </>
      )}

      {postApproveExport ? (
        <LawmindFleetPostApproveBar
          state={postApproveExport}
          workspaceDir={workspaceDir}
          onExport={onPostApproveExport}
          onExportTracked={onPostApproveTrackedExport}
          trackedBusy={trackedExportBusy}
          onOpenReview={onOpenReview}
          onShowArtifact={onShowArtifact}
          onDismiss={onPostApproveDismiss}
          onOpenError={onOpenError}
          onOpenHealth={onOpenHealth}
          onSaveAsAutomation={onSaveAsAutomation}
          saveAsAutomationBusy={saveAsAutomationBusy}
          saveAsAutomationHint={saveAsAutomationHint}
        />
      ) : null}
    </section>
  );
}
