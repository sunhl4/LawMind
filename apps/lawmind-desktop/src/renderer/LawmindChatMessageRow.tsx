import type { ReactNode } from "react";
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
  onOpenReview?: () => void;
  dimmed?: boolean;
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
    dimmed,
  } = props;

  const activityBlocks = msg.role === "assistant" ? resolveMessageActivity(msg) : [];
  const modelFailure = msg.role === "assistant" && msg.failureKind === "model";
  const showActivityFeed =
    msg.role === "assistant" && !modelFailure && (activityBlocks.length > 0 || msg.activityActive);
  const showLegacyTrace =
    msg.role === "assistant" &&
    !modelFailure &&
    !showActivityFeed &&
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

  const workflowPending =
    msg.role === "assistant" &&
    (msg.requiresAction?.some((a) => a.kind === "tool_approval" && a.toolName === "execute_workflow") ??
      false);

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
        {workflowPending ? <LawmindMsgWorkflowApproval /> : null}
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
              compact={index !== lastAssistantIndex}
              mode={index === lastAssistantIndex ? "timeline" : "steps"}
            />
          </div>
        ) : null}
        {msg.role === "user" ? (
          <div className="lm-msg lm-msg-user">{msg.text}</div>
        ) : showThoughtPanel ? (
          displayText ? (
            <LawmindMsgAssistant text={displayText} className="lm-msg-answer" />
          ) : null
        ) : !showLegacyTrace ? (
          <LawmindMsgAssistant text={displayText} modelFailure={modelFailure} />
        ) : displayText ? (
          <LawmindMsgAssistant text={displayText} className="lm-msg-answer" />
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
            {index === lastAssistantIndex && delegateAssistEnabled && onDelegateAssist ? (
              <button type="button" className="lm-msg-copy-btn" onClick={() => onDelegateAssist()}>
                交给其他助手
              </button>
            ) : null}
          </div>
        )}
        {msg.role === "assistant" &&
        index === lastAssistantIndex &&
        (msg.requiresAction?.length ?? 0) > 0 &&
        onResumeRequiresAction ? (
          <LawmindRequiresActionCard
            actions={msg.requiresAction ?? []}
            sessionId={chatSessionId}
            clarificationDraft={clarificationDraft}
            onClarificationDraftChange={onClarificationDraftChange}
            onApproveTool={(a) => void onResumeRequiresAction(a, "approve")}
            onApproveToolEdit={(a, edited) =>
              void onResumeRequiresAction(a, "edit", undefined, edited)
            }
            onRejectTool={(a) => void onResumeRequiresAction(a, "reject")}
            onRespondClarification={(a) =>
              void onResumeRequiresAction(a, "respond", clarificationDraft)
            }
            busy={loading}
          />
        ) : null}
        {msg.role === "assistant" && shouldShowClarifyCard(msg) && !(msg.requiresAction?.length) && (
          <div
            className="lm-clarify-card"
            id={`lm-clarify-card-${index}`}
            data-testid={
              index === pendingClarify.assistantMessageIndex ? "lm-clarify-card-active" : undefined
            }
          >
            <div className="lm-clarify-card-title">
              {msg.status === "awaiting_clarification" ? "还差这些信息" : "建议补充这些"}
            </div>
            <div className="lm-clarify-card-hint">
              {msg.status === "awaiting_clarification" &&
              (msg.clarificationQuestions?.length ?? 0) === 0
                ? "请补充说明后发送。"
                : msg.status === "awaiting_clarification"
                  ? "请填毕下方各项。"
                  : "可在大框说明后发送。"}
            </div>
            {(msg.clarificationQuestions?.length ?? 0) > 0 ? (
              <LawmindClarificationForm
                formKey={`${selectedAssistantId}-${index}`}
                questions={msg.clarificationQuestions ?? []}
                loading={loading}
                onApplyToInput={onApplyPrompt}
                onSend={onSendClarificationMessage}
              />
            ) : (
              <p className="lm-clarify-card-fallback">请在下方输入并发送。</p>
            )}
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
        contextTaskId?.trim() &&
        apiBase ? (
          <LawmindChatDraftStatusBar
            apiBase={apiBase}
            linkedTaskId={contextTaskId}
            assistantText={displayText}
            gateDecisions={msg.gateDecisions}
            onOpenReview={onOpenReview}
          />
        ) : null}
      </div>
    </div>
  );
}
