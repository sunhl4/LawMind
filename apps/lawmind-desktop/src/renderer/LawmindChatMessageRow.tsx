import { useState, type ReactNode } from "react";
import { LawmindAssignmentCommitmentCard } from "./LawmindAssignmentCommitmentCard";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";
import { LawmindChatDraftStatusBar } from "./LawmindChatDraftStatusBar";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "./lawmind-requires-action";
import { LawmindChatExecutionTrace } from "./LawmindChatExecutionTrace";
import { LawmindChatThoughtPanel } from "./LawmindChatThoughtPanel";
import { partitionActivityForThoughtView } from "./lawmind-chat-thought-view.js";
import { resolveMessageActivity } from "./lawmind-chat-activity.js";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { LawmindMsgAssistant } from "./LawmindMsgAssistant";
import { LawmindMsgWorkflowApproval } from "./LawmindMsgWorkflowApproval";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";
import { hasChatDiagnostics, type ChatMsg, type PendingClarificationState } from "./lawmind-chat";
import { formatLawyerGateChip, parseLawyerGateMessage } from "./lawmind-gate-message";
import { isClarificationShortConfirm } from "../../../../src/lawmind/platform/clarification-fields.ts";
import type { NeedsDecisionDeskTarget } from "./lawmind-agents-desk";

function hasClarificationQuestions(message: ChatMsg): boolean {
  return (message.clarificationQuestions?.length ?? 0) > 0;
}

function shouldShowClarifyCard(message: ChatMsg): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  return hasClarificationQuestions(message) || message.status === "awaiting_clarification";
}

export type LawmindChatMessageRowProps = {
  msg: ChatMsg;
  index: number;
  selectedAssistantId: string;
  lastAssistantIndex: number;
  loading: boolean;
  copiedMessageIndex: number | null;
  pendingClarify: PendingClarificationState;
  contextTaskId: string | null;
  apiBase?: string;
  chatSessionId?: string;
  clarificationDraft: Record<string, string>;
  onClarificationDraftChange: (key: string, value: string) => void;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onDelegateAssist?: () => void;
  delegateAssistEnabled?: boolean;
  onResumeRequiresAction?: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  onApplyPrompt: (text: string) => void;
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
  /** Jump to「在办」and select the matching 待补充/待批准 row. */
  onOpenNeedsDecisionDesk?: (target?: NeedsDecisionDeskTarget) => void;
  dimmed?: boolean;
  onDeleteChatMessage?: (uiIndex: number) => void | Promise<void>;
  onEditChatMessage?: (uiIndex: number, nextText: string) => void | Promise<void>;
};

export function LawmindChatMessageRow(props: LawmindChatMessageRowProps): ReactNode {
  const {
    msg,
    index,
    selectedAssistantId,
    lastAssistantIndex,
    loading,
    copiedMessageIndex,
    pendingClarify,
    contextTaskId,
    apiBase,
    chatSessionId,
    clarificationDraft,
    onClarificationDraftChange,
    onCopyMessage,
    onDelegateAssist,
    delegateAssistEnabled,
    onResumeRequiresAction,
    onSendClarificationMessage,
    onApplyPrompt,
    onOpenReview,
    onOpenNeedsDecisionDesk,
    dimmed,
    onDeleteChatMessage,
    onEditChatMessage,
  } = props;

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(msg.text ?? "");
  const [mutateBusy, setMutateBusy] = useState(false);

  const activityBlocks = msg.role === "assistant" ? resolveMessageActivity(msg) : [];
  const modelFailure = msg.role === "assistant" && msg.failureKind === "model";
  const showActivityFeed =
    msg.role === "assistant" && !modelFailure && (activityBlocks.length > 0 || msg.activityActive);
  const showToolTracePref =
    typeof localStorage !== "undefined" &&
    (() => {
      try {
        return localStorage.getItem("lawmind.ui.showToolTrace.v1") === "1";
      } catch {
        return false;
      }
    })();
  const showLegacyTrace =
    msg.role === "assistant" &&
    !modelFailure &&
    (!showActivityFeed || showToolTracePref) &&
    (msg.liveTrace?.steps.length || msg.liveTrace?.active || msg.executionState);
  const streamingThought = loading && index === lastAssistantIndex && Boolean(msg.activityActive);
  const thoughtParts = partitionActivityForThoughtView(activityBlocks, {
    finalText: msg.text,
    streaming: streamingThought,
  });
  const showThoughtPanel =
    showActivityFeed &&
    (streamingThought ||
      thoughtParts.tools.length > 0 ||
      Boolean(thoughtParts.reasoningMarkdown.trim()));
  const displayText = showThoughtPanel
    ? thoughtParts.answerText
    : msg.text?.trim() ||
      (showActivityFeed
        ? activityBlocks
            .filter((b) => b.kind === "text")
            .map((b) => b.content)
            .join("\n\n")
            .trim()
        : "");
  const linkedTaskId =
    contextTaskId?.trim() || msg.executionState?.linkedTaskId?.trim() || undefined;

  const workflowAction =
    msg.role === "assistant"
      ? msg.requiresAction?.find(
          (a) => a.kind === "tool_approval" && a.toolName === "execute_workflow",
        )
      : undefined;
  const workflowPending = Boolean(workflowAction);
  const nonWorkflowRequiresActions =
    msg.requiresAction?.filter(
      (a) => !(a.kind === "tool_approval" && a.toolName === "execute_workflow"),
    ) ?? [];
  const clarifyDeskTarget = (): NeedsDecisionDeskTarget => {
    const clarifyAction = nonWorkflowRequiresActions.find((a) => a.kind === "clarification");
    return {
      sessionId: clarifyAction?.sessionId?.trim() || chatSessionId?.trim() || undefined,
      taskId: clarifyAction?.taskId?.trim() || linkedTaskId,
      matterId: clarifyAction?.matterId?.trim() || undefined,
      preferStatus: "awaiting_clarification",
    };
  };
  const gateMessage =
    msg.role === "user" ? parseLawyerGateMessage(msg.text ?? "") : null;

  return (
    <div
      className={`lm-msg-row ${msg.role === "user" ? "lm-msg-row-user" : ""}${dimmed ? " lm-msg-row-dimmed" : ""}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}
    >
      <div
        className={`lm-msg-avatar ${msg.role === "user" ? "lm-msg-avatar-user" : "lm-msg-avatar-ai"}`}
      >
        {msg.role === "user" ? "我" : "LM"}
      </div>
      <div className={`lm-msg-wrap ${msg.role === "user" ? "lm-msg-wrap-user" : ""}`}>
        {workflowPending ? (
          <LawmindMsgWorkflowApproval
            action={workflowAction}
            busy={loading && index === lastAssistantIndex}
            onApprove={
              workflowAction && onResumeRequiresAction
                ? () => void onResumeRequiresAction(workflowAction, "approve")
                : undefined
            }
            onReject={
              workflowAction && onResumeRequiresAction
                ? () => void onResumeRequiresAction(workflowAction, "reject")
                : undefined
            }
          />
        ) : null}
        {showThoughtPanel ? (
          <div className="lm-msg lm-msg-ai lm-msg-thought">
            <LawmindChatThoughtPanel
              tools={thoughtParts.tools}
              reasoningMarkdown={thoughtParts.reasoningMarkdown}
              streaming={streamingThought}
              renderMarkdown={renderLegalMarkdown}
            />
          </div>
        ) : null}
        {showLegacyTrace ? (
          <div className="lm-msg lm-msg-ai lm-msg-thought">
            <LawmindChatExecutionTrace
              trace={msg.liveTrace}
              executionState={msg.executionState}
              compact={!showToolTracePref && index !== lastAssistantIndex}
              mode={index === lastAssistantIndex || showToolTracePref ? "timeline" : "steps"}
            />
          </div>
        ) : null}
        {msg.role === "assistant" && msg.authorityGapNotice ? (
          <div
            className="lm-callout lm-callout-warn lm-authority-gap"
            role="status"
            data-testid="lm-authority-gap-banner"
          >
            <div className="lm-callout-title">缺源提示</div>
            <p className="lm-callout-body">{msg.authorityGapNotice}</p>
          </div>
        ) : null}
        {msg.role === "assistant" && msg.demoCorpusNotice ? (
          <div
            className="lm-callout lm-callout-warn lm-demo-corpus"
            role="status"
            data-testid="lm-demo-corpus-banner"
          >
            <div className="lm-callout-title">演示语料</div>
            <p className="lm-callout-body">{msg.demoCorpusNotice}</p>
          </div>
        ) : null}
        {msg.role === "user" ? (
          gateMessage ? (
            <div className="lm-msg lm-msg-gate" data-testid="lm-msg-gate" role="status">
              {formatLawyerGateChip(gateMessage)}
            </div>
          ) : editing ? (
            <div className="lm-msg-edit" data-testid="lm-msg-edit">
              <textarea
                className="lm-msg-edit-input"
                value={editDraft}
                rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                disabled={mutateBusy || loading}
                onChange={(e) => setEditDraft(e.target.value)}
                aria-label="修改提问"
              />
              <div className="lm-msg-edit-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-small"
                  disabled={mutateBusy || loading}
                  onClick={() => {
                    setEditing(false);
                    setEditDraft(msg.text ?? "");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-primary lm-btn-small"
                  data-testid="lm-msg-edit-submit"
                  disabled={mutateBusy || loading || !editDraft.trim()}
                  onClick={() => {
                    if (!onEditChatMessage || !editDraft.trim()) {
                      return;
                    }
                    // truncate-from-here removes this bubble and everything after (Cursor-style).
                    if (
                      typeof window !== "undefined" &&
                      !window.confirm(
                        "发送修改后，将从此条起截断后续对话并重新生成。是否继续？",
                      )
                    ) {
                      return;
                    }
                    setMutateBusy(true);
                    void Promise.resolve(onEditChatMessage(index, editDraft))
                      .catch(() => undefined)
                      .finally(() => {
                        setMutateBusy(false);
                        setEditing(false);
                      });
                  }}
                >
                  {mutateBusy ? "发送中…" : "发送修改"}
                </button>
              </div>
            </div>
          ) : (
            <div className="lm-msg lm-msg-user">{msg.text}</div>
          )
        ) : showThoughtPanel ? (
          displayText ? (
            <LawmindMsgAssistant text={displayText} className="lm-msg-answer" />
          ) : null
        ) : !showLegacyTrace ? (
          <LawmindMsgAssistant text={displayText} modelFailure={modelFailure} />
        ) : displayText ? (
          <LawmindMsgAssistant text={displayText} className="lm-msg-answer" />
        ) : null}
        {msg.role === "user" && !gateMessage && (onEditChatMessage || onDeleteChatMessage) ? (
          <div className="lm-msg-actions lm-msg-actions-user">
            {onEditChatMessage && !editing ? (
              <button
                type="button"
                className="lm-msg-copy-btn"
                data-testid="lm-msg-edit"
                disabled={loading || mutateBusy}
                onClick={() => {
                  setEditDraft(msg.text ?? "");
                  setEditing(true);
                }}
              >
                修改
              </button>
            ) : null}
            {onDeleteChatMessage ? (
              <button
                type="button"
                className="lm-msg-copy-btn"
                data-testid="lm-msg-delete"
                disabled={loading || mutateBusy}
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm("删除这条提问及其回答？之后的对话会保留。")
                  ) {
                    return;
                  }
                  setMutateBusy(true);
                  void Promise.resolve(onDeleteChatMessage(index))
                    .catch(() => undefined)
                    .finally(() => setMutateBusy(false));
                }}
              >
                删除
              </button>
            ) : null}
          </div>
        ) : null}
        {msg.role === "assistant" && (
          <div className="lm-msg-actions">
            <button
              type="button"
              className="lm-msg-copy-btn"
              onClick={() => void onCopyMessage(displayText, index)}
            >
              {copiedMessageIndex === index ? "已复制 ✓" : "复制"}
            </button>
            {onDeleteChatMessage ? (
              <button
                type="button"
                className="lm-msg-copy-btn"
                data-testid="lm-msg-delete-assistant"
                disabled={loading || mutateBusy}
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm("删除这条回答？")
                  ) {
                    return;
                  }
                  setMutateBusy(true);
                  void Promise.resolve(onDeleteChatMessage(index))
                    .catch(() => undefined)
                    .finally(() => setMutateBusy(false));
                }}
              >
                删除
              </button>
            ) : null}
            {index === lastAssistantIndex && delegateAssistEnabled && onDelegateAssist ? (
              <button type="button" className="lm-msg-copy-btn" onClick={() => onDelegateAssist()}>
                交给其他助手
              </button>
            ) : null}
          </div>
        )}
        {msg.role === "assistant" &&
        index === lastAssistantIndex &&
        nonWorkflowRequiresActions.length > 0 &&
        onResumeRequiresAction ? (
          <div
            id={`lm-clarify-card-${index}`}
            data-testid={
              index === pendingClarify.assistantMessageIndex ? "lm-clarify-card-active" : undefined
            }
          >
            <LawmindRequiresActionCard
              actions={nonWorkflowRequiresActions}
              sessionId={chatSessionId}
              clarificationDraft={clarificationDraft}
              onClarificationDraftChange={onClarificationDraftChange}
              onApproveTool={(a) => void onResumeRequiresAction(a, "approve")}
              onApproveToolEdit={(a, edited) =>
                void onResumeRequiresAction(a, "edit", undefined, edited)
              }
              onRejectTool={(a) => void onResumeRequiresAction(a, "reject")}
              onRespondClarification={(a, answers) =>
                void onResumeRequiresAction(a, "respond", answers ?? clarificationDraft)
              }
              onOpenNeedsDecisionDesk={onOpenNeedsDecisionDesk}
              onOpenReview={
                onOpenReview
                  ? (taskId, matterId) => onOpenReview({ taskId, matterId })
                  : undefined
              }
              clarificationVariant={
                isClarificationShortConfirm(
                  nonWorkflowRequiresActions.find((a) => a.kind === "clarification")
                    ?.clarificationQuestions ?? [],
                )
                  ? "compact"
                  : "hint"
              }
              busy={loading}
            />
          </div>
        ) : null}
        {msg.role === "assistant" && shouldShowClarifyCard(msg) && !(msg.requiresAction?.length) && (
          <div
            className="lm-clarify-card"
            id={`lm-clarify-card-${index}`}
            data-testid={
              index === pendingClarify.assistantMessageIndex ? "lm-clarify-card-active" : undefined
            }
          >
            {(() => {
              const qs = msg.clarificationQuestions ?? [];
              const short = isClarificationShortConfirm(qs);
              const blocking = msg.status === "awaiting_clarification";
              if (blocking && qs.length > 0 && !short) {
                return (
                  <>
                    <div className="lm-clarify-card-title">还差 {qs.length} 项信息</div>
                    <div className="lm-clarify-card-hint">
                      请到「在办」用表格补充（可填表或挂材料）。对话里不必重复填大表。
                    </div>
                    <ul className="lm-clarify-weak-list">
                      {qs.slice(0, 6).map((q) => (
                        <li key={q.key}>{q.question}</li>
                      ))}
                    </ul>
                    <div className="lm-clarify-form-actions">
                      {onOpenNeedsDecisionDesk ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-accent lm-clarify-btn"
                          data-testid="lm-clarify-open-desk"
                          disabled={loading}
                          onClick={() => onOpenNeedsDecisionDesk(clarifyDeskTarget())}
                        >
                          去在办补充
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-clarify-btn"
                        disabled={loading}
                        onClick={() => onApplyPrompt(qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n"))}
                      >
                        把问题列到输入框
                      </button>
                    </div>
                  </>
                );
              }
              return (
                <>
                  <div className="lm-clarify-card-title">
                    {blocking ? "还差这些信息" : "建议补充这些"}
                  </div>
                  <div className="lm-clarify-card-hint">
                    {blocking && qs.length === 0
                      ? "请补充说明后发送，或到「在办」处理。"
                      : short
                        ? "一两项短确认可在此填写；复杂项请到「在办」。"
                        : "可在大框说明后发送。"}
                  </div>
                  {qs.length > 0 ? (
                    <LawmindClarificationForm
                      formKey={`${selectedAssistantId}-${index}`}
                      questions={qs}
                      loading={loading}
                      variant={short && blocking ? "compact" : "chat"}
                      values={clarificationDraft}
                      onValuesChange={(next) => {
                        for (const [key, value] of Object.entries(next)) {
                          if ((clarificationDraft[key] ?? "") !== value) {
                            onClarificationDraftChange(key, value);
                          }
                        }
                      }}
                      onSubmitAnswers={
                        short && blocking
                          ? async (answers) => {
                              await onSendClarificationMessage(
                                Object.entries(answers)
                                  .map(([k, v]) => {
                                    const q = qs.find((item) => item.key === k);
                                    return q ? `${q.question}\n答：${v}` : v;
                                  })
                                  .join("\n\n"),
                              );
                            }
                          : undefined
                      }
                      onApplyToInput={onApplyPrompt}
                      onSend={onSendClarificationMessage}
                      onOpenDesk={() => onOpenNeedsDecisionDesk?.(clarifyDeskTarget())}
                    />
                  ) : (
                    <p className="lm-clarify-card-fallback">请在下方输入并发送。</p>
                  )}
                </>
              );
            })()}
          </div>
        )}
        {msg.role === "assistant" && hasChatDiagnostics(msg) && (
          <LawmindMemorySourcesPanel
            layers={msg.memorySources ?? []}
            toolCallSequence={msg.toolCallSequence}
            variant="chat"
          />
        )}
        {msg.role === "assistant" &&
        index === lastAssistantIndex &&
        linkedTaskId &&
        apiBase ? (
          <>
            <LawmindAssignmentCommitmentCard
              apiBase={apiBase}
              taskId={linkedTaskId}
              onOpenReview={onOpenReview}
              assistantReply={displayText}
            />
            <LawmindChatDraftStatusBar
              apiBase={apiBase}
              linkedTaskId={linkedTaskId}
              assistantText={displayText}
              gateDecisions={msg.gateDecisions}
              onOpenReview={onOpenReview}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
