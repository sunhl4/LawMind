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

const SCENARIO_CARDS: Array<{ title: string; description: string; prompt: string }> = [
  {
    title: "起草文书",
    description: "律师函、诉状、公函",
    prompt: "请帮我起草一份律师函，核心事实与诉求如下：\n\n",
  },
  {
    title: "法规检索",
    description: "条文、判例、政策文件",
    prompt: "请检索以下法律问题的相关法规、司法解释与裁判要旨：\n\n",
  },
  {
    title: "合同审查",
    description: "逐条标注风险与建议",
    prompt: "请对以下合同进行逐条审查，并列出关键风险点与修改建议：\n\n",
  },
];

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
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
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
  showEmptyMatterGuide?: boolean;
  onDeleteChatMessage?: (uiIndex: number) => void | Promise<void>;
  onEditChatMessage?: (uiIndex: number, nextText: string) => void | Promise<void>;
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
  onRemoveFileChatPill: _onRemoveFileChatPill,
  onClearFileChatPills: _onClearFileChatPills,
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
  onCreateMatter,
  onOpenAgentsWorkflows,
  onOpenWorkflowLibrary,
  onOpenWriteMaterials,
  showEmptyMatterGuide = false,
  onDeleteChatMessage,
  onEditChatMessage,
}: LawmindChatMessagesColumnProps) {
  const openNeedsDecisionDesk = onOpenNeedsDecisionDesk ?? onOpenActionHub;
  const openAgentsWorkflows = onOpenAgentsWorkflows ?? onOpenWorkflowLibrary;
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
      />
    );
  };

  return (
    <>
      {revisionBackgroundActive && contextTaskId?.trim() && onOpenReview ? (
        <div className="lm-chat-revision-banner" role="status">
          <span>正在后台修订草稿，执行过程见下方；完成后可进入文书台改稿，正式签批请回在办。</span>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-small"
            onClick={() => onOpenReview({ taskId: contextTaskId?.trim() || undefined })}
          >
            进入文书台
          </button>
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
        aria-live="polite"
        aria-atomic="false"
      >
        {currentMessages.length === 0 ? (
          <div className="lm-messages-empty">
            <div className="lm-messages-empty-icon">L</div>
            <div className="lm-messages-empty-title">开始对话</div>
            <p className="lm-messages-empty-lead">
              用自然语言下达即可；材料不齐时优先「写材料」填表，再点下方场景或「按流程办」。
            </p>
            {(onOpenWriteMaterials || onCreateMatter || openAgentsWorkflows) ? (
              <div className="lm-messages-empty-actions">
                {onOpenWriteMaterials ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    data-testid="lm-empty-write-materials"
                    onClick={onOpenWriteMaterials}
                  >
                    写材料（填表）
                  </button>
                ) : null}
                {showEmptyMatterGuide && onCreateMatter ? (
                  <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onCreateMatter}>
                    新建案件
                  </button>
                ) : null}
                {openAgentsWorkflows ? (
                  <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={openAgentsWorkflows}>
                    按流程办
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="lm-scenario-cards lm-scenario-cards-compact">
              {SCENARIO_CARDS.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  className="lm-scenario-card"
                  onClick={() => onApplyPrompt(card.prompt)}
                >
                  <span className="lm-scenario-title">{card.title}</span>
                  <span className="lm-scenario-desc">{card.description}</span>
                </button>
              ))}
            </div>
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

