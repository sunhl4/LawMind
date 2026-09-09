/**
 * Chat messages column (history, empty guide, virtual list).
 * Extracted from lawmind-chat-shell for maintainability (R-P1-2).
 */

import type { ReactNode, RefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import { LawmindWorkflowSuggestBanner } from "./LawmindWorkflowSuggestBanner";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "./lawmind-requires-action";
import { LawmindChatHistorySearch } from "./LawmindChatHistorySearch";
import { LawmindChatMessageRow } from "./LawmindChatMessageRow";
import { LawmindChatMessagesVirtualList } from "./LawmindChatMessagesVirtualList";
import { LawmindMsgCompactNotice } from "./LawmindMsgCompactNotice";
import { LawmindMsgToolGroup } from "./LawmindMsgToolGroup";
import {
  getPendingClarificationState,
  type ChatMsg,
} from "./lawmind-chat";
import {
  preprocessChatMessages,
  type RenderableChatItem,
} from "./lawmind-message-preprocess";
import type { ReviewOpenTarget } from "./LawmindChatReviewSticky";

export type LawmindChatMessagesColumnProps = {
  selectedAssistantId: string;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  loading: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onApplyPrompt: (prompt: string) => void;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  fileChatPills: Array<{ id: string; shortLabel: string; title: string; relPath?: string }>;
  contextTaskId: string | null;
  apiBase?: string;
  onOpenReview?: (target?: ReviewOpenTarget) => void;
  onDelegateAssist?: () => void;
  delegateAssistEnabled?: boolean;
  chatSessionId?: string;
  onResumeRequiresAction?: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  onOpenNeedsDecisionDesk?: (
    target?: import("./lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
  revisionBackgroundActive?: boolean;
  streamCompactLabels?: string[];
  onCreateMatter?: () => void;
  /** Opens「在办 · 按流程办」. */
  onOpenAgentsWorkflows?: () => void;
  /** @deprecated Use onOpenAgentsWorkflows */
  onOpenWorkflowLibrary?: () => void;
  /** Opens compose「写材料」template / job-intake gallery. */
  onOpenWriteMaterials?: () => void;
  /** 空态「5 分钟合同审查」一键发送（有则显示开始审查）。 */
  onDispatchPrompt?: (prompt: string) => void;
  showEmptyMatterGuide?: boolean;
  onDeleteChatMessage?: (uiIndex: number) => void | Promise<void>;
  onEditChatMessage?: (uiIndex: number, nextText: string) => void | Promise<void>;
  allowWebSearch?: boolean;
  webSearchPolicyBlocked?: boolean;
  onOpenComposeSettings?: () => void;
  onOpenSettings?: () => void;
  onOpenDoctor?: () => void;
  workspaceDir?: string;
};

export function LawmindChatMessagesColumn({
  selectedAssistantId,
  currentMessages,
  copiedMessageIndex,
  loading,
  messagesEndRef,
  onCopyMessage,
  onApplyPrompt,
  onSendClarificationMessage,
  fileChatPills,
  contextTaskId,
  apiBase,
  onOpenReview,
  onDelegateAssist,
  delegateAssistEnabled,
  chatSessionId,
  onResumeRequiresAction,
  onOpenNeedsDecisionDesk,
  onOpenActionHub,
  revisionBackgroundActive,
  streamCompactLabels = [],
  onDeleteChatMessage,
  onEditChatMessage,
  onOpenComposeSettings,
  onOpenSettings,
  onOpenDoctor,
  workspaceDir,
}: LawmindChatMessagesColumnProps) {
  const openNeedsDecisionDesk = onOpenNeedsDecisionDesk ?? onOpenActionHub;
  const openSettingsSection = (section: "models" | "doctor") => {
    if (section === "doctor") {
      (onOpenDoctor ?? onOpenSettings ?? onOpenComposeSettings)?.();
      return;
    }
    (onOpenComposeSettings ?? onOpenSettings)?.();
  };
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [searchHighlight, setSearchHighlight] = useState<Set<number> | null>(null);
  const pendingClarify = getPendingClarificationState(currentMessages);
  const lastAssistantIndex = useMemo(() => {
    for (let i = currentMessages.length - 1; i >= 0; i -= 1) {
      if (currentMessages[i]?.role === "assistant") {
        return i;
      }
    }
    return -1;
  }, [currentMessages]);

  const renderableItems = useMemo(() => {
    const base = preprocessChatMessages(currentMessages, {
      briefOnly: false,
      collapseSearch: true,
      groupTools: true,
    });
    const notices: RenderableChatItem[] = streamCompactLabels.map((label, i) => ({
      kind: "compact_notice" as const,
      label,
      sourceIndex: -1 - i,
    }));
    return notices.length > 0 ? [...notices, ...base] : base;
  }, [currentMessages, streamCompactLabels]);

  const onHighlightIndices = useCallback((indices: Set<number> | null) => {
    setSearchHighlight(indices);
  }, []);

  const renderItem = (item: RenderableChatItem, listKey: string): ReactNode => {
    if (item.kind === "compact_notice") {
      return <LawmindMsgCompactNotice key={listKey} label={item.label} />;
    }
    if (item.kind === "tool_group") {
      return (
        <LawmindMsgToolGroup
          key={listKey}
          messages={item.messages}
          sourceIndices={item.sourceIndices}
          defaultCollapsed={item.collapsed}
        />
      );
    }
    const index = item.sourceIndex;
    const dimmed = searchHighlight != null && !searchHighlight.has(index);
    return (
      <LawmindChatMessageRow
        key={listKey}
        msg={item.message}
        index={index}
        selectedAssistantId={selectedAssistantId}
        lastAssistantIndex={lastAssistantIndex}
        loading={loading}
        copiedMessageIndex={copiedMessageIndex}
        pendingClarify={pendingClarify}
        contextTaskId={contextTaskId}
        apiBase={apiBase}
        chatSessionId={chatSessionId}
        clarificationDraft={clarificationDraft}
        onClarificationDraftChange={(key, value) =>
          setClarificationDraft((d) => ({ ...d, [key]: value }))
        }
        onCopyMessage={onCopyMessage}
        onDelegateAssist={onDelegateAssist}
        delegateAssistEnabled={delegateAssistEnabled}
        onResumeRequiresAction={onResumeRequiresAction}
        onSendClarificationMessage={onSendClarificationMessage}
        onApplyPrompt={onApplyPrompt}
        onOpenReview={onOpenReview}
        onOpenNeedsDecisionDesk={openNeedsDecisionDesk}
        dimmed={dimmed}
        onDeleteChatMessage={onDeleteChatMessage}
        onEditChatMessage={onEditChatMessage}
        onOpenSettingsSection={openSettingsSection}
        workspaceDir={workspaceDir}
      />
    );
  };

  return (
    <>
      {revisionBackgroundActive && contextTaskId?.trim() ? (
        <div className="lm-chat-revision-banner" role="status">
          <span>修订中…完成后打开结果即可改。</span>
          {onOpenReview ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-small"
              data-testid="lm-chat-revision-signoff"
              onClick={() => onOpenReview({ taskId: contextTaskId?.trim() || undefined })}
            >
              打开结果
            </button>
          ) : openNeedsDecisionDesk ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-small"
              data-testid="lm-chat-revision-signoff"
              onClick={() =>
                openNeedsDecisionDesk({
                  taskId: contextTaskId.trim(),
                  preferStatus: "awaiting_review",
                })
              }
            >
              打开结果
            </button>
          ) : null}
        </div>
      ) : null}
      {apiBase && fileChatPills.length > 0 ? (
        <LawmindWorkflowSuggestBanner
          apiBase={apiBase}
          pinnedRelPaths={fileChatPills.map((p) => p.relPath ?? p.title)}
        />
      ) : null}
      <div className="lm-messages-toolbar">
        <LawmindChatHistorySearch items={renderableItems} onHighlightIndices={onHighlightIndices} />
      </div>
      <div
        id="lawmind-chat-messages-panel"
        className="lm-messages lm-chat-messages"
        role="region"
        aria-label="对话消息"
        aria-busy={loading}
        aria-live="polite"
        aria-atomic="false"
      >
        {currentMessages.length === 0 ? (
          <div className="lm-messages-empty" data-testid="lm-chat-empty">
            <div className="lm-messages-empty-icon">L</div>
            <div className="lm-messages-empty-title">开始对话</div>
            <p className="lm-messages-empty-lead">
              先把合同、函件或资料附上（拖入或点「办件」），再选要走的流程。
            </p>
            <p className="lm-messages-empty-hint">签批与导出仍在「在办」。不必记住激活词。</p>
          </div>
        ) : (
          <LawmindChatMessagesVirtualList count={renderableItems.length} enabled>
            {(virtualIndex) =>
              renderItem(
                renderableItems[virtualIndex],
                `${selectedAssistantId}-item-${virtualIndex}`,
              )
            }
          </LawmindChatMessagesVirtualList>
        )}
        {/* Anchor for layout; scroll-to-latest uses panel.scrollTop (see lawmind-chat-scroll). */}
        <div ref={messagesEndRef} data-testid="lm-chat-messages-end" />
      </div>
    </>
  );
}

