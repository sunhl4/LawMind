import React, { useState, type RefObject } from "react";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { ChatSessionListEntry } from "../lawmind-chat-active-storage";
import { LawmindChatSessionTabs } from "../LawmindChatSessionTabs";
import { LawmindChatMessagesColumn, LawmindChatComposeFooter } from "../lawmind-chat-shell";
import type { ChatMsg } from "../lawmind-chat";
import { formatFileChatContextPill, type FileChatContextItem } from "../lawmind-file-chat-context";
import type { TruthSourceContextPin } from "../../../../../src/lawmind/platform/compose-context-pin.ts";
import { formatTruthPinChip } from "../lawmind-compose-context";
import { LawmindWorkspacePaneRecovery } from "./LawmindWorkspacePaneRecovery";
import { LawmindSessionHistorySidebar } from "../LawmindSessionHistorySidebar";
import { useLawmindChatSessionContext } from "./LawmindShellContexts";
import type {
  LawMindRequiresAction,
  LawMindRequiresActionDecision,
} from "../lawmind-requires-action";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";
import type { ReviewOpenTarget } from "../LawmindChatReviewSticky";

export type LawmindWorkspaceMainPaneProps = {
  canUseFilesystemBridge: boolean;
  setFileEditorHost: (el: HTMLDivElement | null) => void;
  wsShowEditor: boolean;
  onShowEditorPane: () => void;
  wsShowChat: boolean;
  onShowChatPane: () => void;
  onWsChatSplitResize: (e: React.PointerEvent<HTMLDivElement>) => void;
  wsChatColWidth: number;
  chatSessionList: ChatSessionListEntry[];
  chatSessionsLoading: boolean;
  loading: boolean;
  onSelectChatSession: (id: string) => void | Promise<void>;
  onCreateNewChatSession: () => void | Promise<void>;
  onRenameChatSession: (id: string, title: string) => void | Promise<void>;
  onDeleteChatSession: (id: string) => void | Promise<void>;
  config: AppConfig | null;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onInputChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  streamCompactLabels: string[];
  fileChatContextItems: FileChatContextItem[];
  composeTruthPins?: TruthSourceContextPin[];
  onAddComposeTruthPin?: (pin: TruthSourceContextPin) => void;
  onRemoveTruthPin?: (id: string) => void;
  onClearTruthPills?: () => void;
  onAddFileToChatContext?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  contextTaskId: string | null;
  onOpenReview: (target?: ReviewOpenTarget) => void;
  onDelegateAssist: () => void;
  delegateAssistEnabled: boolean;
  revisionBackgroundActive: boolean;
  onResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  input: string;
  error: string | null;
  contextMatterId: string | null;
  chatMatterHeadline: string | null;
  onSend: () => void | Promise<void>;
  onAbortChat: () => void;
  onDeleteChatMessage?: (uiIndex: number) => void | Promise<void>;
  onEditChatMessage?: (uiIndex: number, nextText: string) => void | Promise<void>;
  onClearContext: () => void;
  onContextMatterChange?: (matterId: string | null) => void;
  onOpenComposeSettings: () => void;
  /** Open Settings → memory inspector. */
  onOpenMemoryInspector?: () => void;
  onOpenApiWizard: () => void;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  onComposeModelQuickTest: () => void | Promise<void>;
  composeModelConfigured?: boolean;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect: (modelId: string) => void | Promise<void>;
  allowWebSearch: boolean;
  webSearchPolicyBlocked?: boolean;
  onAllowWebSearchChange: (value: boolean) => void;
  queuedMessages: string[];
  cancelQueuedMessage: (index: number) => void;
  onOpenTaskDrawer: () => void;
  onOpenNeedsDecisionDesk?: (
    target?: import("../lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
  composeExtras: LawmindComposeExtras;
  onCreateMatter?: () => void;
  onOpenAgentsWorkflows?: () => void;
  /** @deprecated Use onOpenAgentsWorkflows */
  onOpenWorkflowLibrary?: () => void;
  showEmptyMatterGuide?: boolean;
  /** When true, session list lives in the left rail — hide top tabs. */
  chatSessionsInSidebar?: boolean;
};

function LawmindWorkspaceMainPaneImpl({
  canUseFilesystemBridge,
  setFileEditorHost,
  wsShowEditor,
  onShowEditorPane,
  wsShowChat,
  onShowChatPane,
  onWsChatSplitResize,
  wsChatColWidth,
  chatSessionList,
  chatSessionsLoading,
  loading,
  onSelectChatSession,
  onCreateNewChatSession,
  onRenameChatSession,
  onDeleteChatSession,
  config,
  currentMessages,
  copiedMessageIndex,
  messagesEndRef,
  onCopyMessage,
  onInputChange,
  textareaRef,
  onSendClarificationMessage,
  streamCompactLabels,
  fileChatContextItems,
  composeTruthPins = [],
  onAddComposeTruthPin,
  onRemoveTruthPin,
  onClearTruthPills,
  onAddFileToChatContext,
  onRemoveFileChatPill,
  onClearFileChatPills,
  contextTaskId,
  onOpenReview,
  onDelegateAssist,
  delegateAssistEnabled,
  revisionBackgroundActive,
  onResumeRequiresAction,
  input,
  error,
  contextMatterId,
  chatMatterHeadline,
  onSend,
  onAbortChat,
  onDeleteChatMessage,
  onEditChatMessage,
  onClearContext,
  onContextMatterChange,
  onOpenComposeSettings,
  onOpenMemoryInspector,
  onOpenApiWizard,
  composeModelHint,
  composeModelQuickTestBusy,
  onComposeModelQuickTest,
  composeModelConfigured,
  modelCatalog,
  selectedModelId,
  onModelSelect,
  allowWebSearch,
  webSearchPolicyBlocked,
  onAllowWebSearchChange,
  queuedMessages,
  cancelQueuedMessage,
  onOpenTaskDrawer,
  onOpenNeedsDecisionDesk,
  onOpenActionHub,
  composeExtras,
  onCreateMatter,
  onOpenAgentsWorkflows,
  onOpenWorkflowLibrary,
  showEmptyMatterGuide,
  chatSessionsInSidebar = false,
}: LawmindWorkspaceMainPaneProps) {
  const { selectedAssistantId, activeChatSessionId } = useLawmindChatSessionContext();
  const chatSessionId = activeChatSessionId;
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const openNeedsDecisionDesk = onOpenNeedsDecisionDesk ?? onOpenActionHub;
  const openAgentsWorkflows = onOpenAgentsWorkflows ?? onOpenWorkflowLibrary;
  const fileChatPills = fileChatContextItems.map((it) => ({
    id: it.id,
    relPath: it.relPath,
    ...formatFileChatContextPill(it),
  }));
  const truthPills = composeTruthPins.map((pin) => formatTruthPinChip(pin));
  const bothWorkspacePanesHidden = !wsShowChat && (!canUseFilesystemBridge || !wsShowEditor);

  return (
    <div className="lm-workspace-unified lm-cursor-workspace">
      <div className="lm-cursor-panes-row">
        {bothWorkspacePanesHidden ? (
          <LawmindWorkspacePaneRecovery
            canUseFilesystemBridge={canUseFilesystemBridge}
            onShowChat={onShowChatPane}
            onShowEditor={onShowEditorPane}
          />
        ) : null}
        {canUseFilesystemBridge ? (
          <div
            ref={setFileEditorHost}
            className="lm-cursor-pane-editor-host lm-file-editor-host"
            style={{
              display: wsShowEditor ? "flex" : "none",
              flexDirection: "column",
              flex: wsShowEditor ? "1 1 0%" : "0 0 0",
              minHeight: 0,
              minWidth: 0,
              overflow: "hidden",
            }}
          />
        ) : null}
        {canUseFilesystemBridge && wsShowEditor && wsShowChat ? (
          <div
            className="lm-split-handle lm-split-handle-vertical"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整编辑器与对话区宽度"
            title="拖动调整对话区宽度"
            onPointerDown={onWsChatSplitResize}
          />
        ) : null}
        {wsShowChat ? (
          <div
            className="lm-cursor-chat-pane"
            style={{
              flex:
                canUseFilesystemBridge && wsShowEditor
                  ? `0 0 ${wsChatColWidth}px`
                  : "1 1 0",
              width:
                canUseFilesystemBridge && wsShowEditor ? wsChatColWidth : undefined,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div className="lm-chat-workspace lm-chat-workspace-messages-only">
              {!chatSessionsInSidebar ? (
                <LawmindChatSessionTabs
                  sessions={chatSessionList.map((row) => ({
                    sessionId: row.sessionId,
                    title: row.title,
                  }))}
                  activeSessionId={activeChatSessionId}
                  loading={chatSessionsLoading}
                  busy={loading}
                  onSelect={(id) => void onSelectChatSession(id)}
                  onNewChat={() => void onCreateNewChatSession()}
                  onRename={(id, title) => void onRenameChatSession(id, title)}
                  onDelete={(id) => void onDeleteChatSession(id)}
                  trailing={
                    config?.apiBase ? (
                      <LawmindSessionHistorySidebar
                        compact
                        apiBase={config.apiBase}
                        assistantId={selectedAssistantId}
                        sessions={chatSessionList}
                        activeSessionId={activeChatSessionId}
                        busy={loading || chatSessionsLoading}
                        onSelect={(id) => void onSelectChatSession(id)}
                      />
                    ) : null
                  }
                />
              ) : null}
              <LawmindChatMessagesColumn
                selectedAssistantId={selectedAssistantId}
                currentMessages={currentMessages}
                copiedMessageIndex={copiedMessageIndex}
                loading={loading}
                messagesEndRef={messagesEndRef}
                onCopyMessage={(text, index) => void onCopyMessage(text, index)}
                onApplyPrompt={(prompt) => {
                  onInputChange(prompt);
                  textareaRef.current?.focus();
                }}
                onSendClarificationMessage={(text) => void onSendClarificationMessage(text)}
                streamCompactLabels={streamCompactLabels}
                fileChatPills={fileChatPills}
                onRemoveFileChatPill={onRemoveFileChatPill}
                onClearFileChatPills={onClearFileChatPills}
                contextTaskId={contextTaskId}
                apiBase={config?.apiBase}
                onOpenReview={onOpenReview}
                onDelegateAssist={onDelegateAssist}
                delegateAssistEnabled={delegateAssistEnabled}
                revisionBackgroundActive={revisionBackgroundActive}
                chatSessionId={chatSessionId}
                onResumeRequiresAction={onResumeRequiresAction}
                onOpenNeedsDecisionDesk={openNeedsDecisionDesk}
                onCreateMatter={onCreateMatter}
                onOpenAgentsWorkflows={openAgentsWorkflows}
                onOpenWriteMaterials={() => setTemplateGalleryOpen(true)}
                showEmptyMatterGuide={showEmptyMatterGuide}
                onDeleteChatMessage={onDeleteChatMessage}
                onEditChatMessage={onEditChatMessage}
              />
            </div>
            <LawmindChatComposeFooter
              currentMessages={currentMessages}
              input={input}
              loading={loading}
              error={error}
              contextTaskId={contextTaskId}
              contextMatterId={contextMatterId}
              matterTitle={chatMatterHeadline}
              textareaRef={textareaRef}
              onInputChange={onInputChange}
              onSend={() => void onSend()}
              onAbortChat={onAbortChat}
              onApplyPrompt={(prompt) => {
                onInputChange(prompt);
                textareaRef.current?.focus();
              }}
              onDispatchJob={onSendClarificationMessage}
              onClearContext={onClearContext}
              onContextMatterChange={onContextMatterChange}
              onOpenComposeSettings={onOpenComposeSettings}
              onOpenApiWizard={onOpenApiWizard}
              composeModelHint={composeModelHint}
              composeModelQuickTestBusy={composeModelQuickTestBusy}
              onComposeModelQuickTest={onComposeModelQuickTest}
              composeModelConfigured={composeModelConfigured}
              modelCatalog={modelCatalog}
              selectedModelId={selectedModelId}
              onModelSelect={onModelSelect}
              onDelegateAssist={onDelegateAssist}
              delegateAssistEnabled={delegateAssistEnabled}
              allowWebSearch={allowWebSearch}
              webSearchPolicyBlocked={webSearchPolicyBlocked}
              onAllowWebSearchChange={onAllowWebSearchChange}
              apiBase={config?.apiBase}
              chatSessionId={chatSessionId}
              queuedMessages={queuedMessages}
              cancelQueuedMessage={cancelQueuedMessage}
              onOpenTaskDrawer={onOpenTaskDrawer}
              onOpenNeedsDecisionDesk={openNeedsDecisionDesk}
              onOpenMemoryInspector={onOpenMemoryInspector}
              onOpenReview={onOpenReview}
              composeExtras={composeExtras}
              fileChatPills={fileChatPills}
              truthPills={truthPills}
              fileChatContextItems={fileChatContextItems}
              composeTruthPins={composeTruthPins}
              onAddFileToChatContext={onAddFileToChatContext}
              onAddComposeTruthPin={onAddComposeTruthPin}
              onRemoveFileChatPill={onRemoveFileChatPill}
              onRemoveTruthPill={onRemoveTruthPin}
              onClearFileChatPills={onClearFileChatPills}
              onClearTruthPills={onClearTruthPills}
              templateGalleryOpen={templateGalleryOpen}
              onTemplateGalleryOpenChange={setTemplateGalleryOpen}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const LawmindWorkspaceMainPane = React.memo(LawmindWorkspaceMainPaneImpl);
