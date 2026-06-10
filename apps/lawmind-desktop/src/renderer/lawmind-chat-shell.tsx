import type { RefObject, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LawmindCommandPalette, type CommandPaletteAction } from "./LawmindCommandPalette";
import { readComposeStash, writeComposeStash, type ComposePermissionMode } from "./lawmind-compose-prefs";
import type { LawmindComposeExtras } from "./useLawmindComposeExtras";
import { LawmindWorkflowSuggestBanner } from "./LawmindWorkflowSuggestBanner";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "./lawmind-requires-action";
import { LawmindModelPicker } from "./LawmindModelPicker";
import { LawmindChatHistorySearch } from "./LawmindChatHistorySearch";
import { LawmindChatMessageRow } from "./LawmindChatMessageRow";
import { LawmindChatMessagesVirtualList } from "./LawmindChatMessagesVirtualList";
import { LawmindMsgCompactNotice } from "./LawmindMsgCompactNotice";
import { LawmindMsgToolGroup } from "./LawmindMsgToolGroup";
import {
  getPendingClarificationState,
  handleEnterSendShiftNewline,
  type ChatMsg,
} from "./lawmind-chat";
import {
  preprocessChatMessages,
  readBriefOnlyPreference,
  writeBriefOnlyPreference,
  type RenderableChatItem,
} from "./lawmind-message-preprocess";
import {
  LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
  LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
} from "./lawmind-panel-layout";
import { usePaneResizeVerticalPx } from "./use-pane-resize";
import { internalIdsTitle } from "./display-ids";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { LawmindComposeAttachments } from "./LawmindComposeAttachments";
import { LawmindComposeContextPicker } from "./LawmindComposeContextPicker";
import { LawmindComposeTemplateGallery } from "./LawmindComposeTemplateGallery";
import { LawmindRequiresActionStrip } from "./LawmindRequiresActionStrip";
import type { FileChatContextItem } from "./lawmind-app-shell";
import {
  parseAtTrigger,
  rememberFileContextPath,
  removeAtTokenFromInput,
  type ComposeContextMatterOption,
} from "./lawmind-compose-context";

const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "起草律师函", prompt: "请帮我起草一封律师函，就以下事项发出法律警告：\n\n" },
  { label: "合同审查", prompt: "请对以下合同进行风险审查，逐条标注重点风险点：\n\n" },
  { label: "法规检索", prompt: "请检索以下法律问题的相关法规、司法解释和典型判例：\n\n" },
  { label: "起草诉状", prompt: "请帮我起草民事起诉状，案情简述如下：\n\n" },
  { label: "案例查询", prompt: "请查找与以下纠纷类似的典型判例及裁判要旨：\n\n" },
];

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

export { hasChatDiagnostics } from "./lawmind-chat";

export type LawmindChatWorkspaceProps = {
  selectedAssistantId: string;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  input: string;
  loading: boolean;
  error: string | null;
  allowWebSearch: boolean;
  /** 工作区策略禁止联网时禁用联网下拉 */
  webSearchPolicyBlocked?: boolean;
  contextTaskId: string | null;
  contextMatterId: string | null;
  apiBase?: string;
  onOpenReview?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onAllowWebSearchChange: (value: boolean) => void;
  onSend: () => void | Promise<void>;
  /** 请求进行中时中止当前对话请求（与「发送」同位切换为「停止」） */
  onAbortChat?: () => void;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onApplyPrompt: (prompt: string) => void;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  onClearContext: () => void;
  /** 关联案件标题（可空） */
  matterTitle: string | null;
  /** 在「文件」页标记的、将拼入发送给模型的路径引用 */
  fileChatPills: Array<{ id: string; shortLabel: string; title: string; relPath?: string }>;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  onAddFileToChatContext?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onContextMatterChange?: (matterId: string | null) => void;
  composeMatterOptions?: ComposeContextMatterOption[];
  fileChatContextItems?: FileChatContextItem[];
  /** 打开设置（模型/API、联网密钥等） */
  onOpenComposeSettings?: () => void;
  /** 打开设置首页（上次所在分区或概览） */
  onOpenSettings?: () => void;
  /** 打开设置 → 概览与体检 */
  onOpenDoctor?: () => void;
  /** 打开 API 配置向导（与 Cursor「注册」模型入口类似） */
  onOpenApiWizard?: () => void;
  /** 主模型是否已在环境中配置；未加载 health 时可不传 */
  composeModelConfigured?: boolean;
  modelCatalog?: ModelCatalogEntry[];
  selectedModelId?: string;
  onModelSelect?: (modelId: string) => void | Promise<void>;
  /** `POST /api/models/test` 后的简短状态（成功/失败文案） */
  composeModelHint?: string | null;
  composeModelQuickTestBusy?: boolean;
  onComposeModelQuickTest?: () => void | Promise<void>;
  /** 打开「交给其他助手」对话框 */
  onDelegateAssist?: () => void;
  delegateAssistEnabled?: boolean;
  chatSessionId?: string;
  onResumeRequiresAction?: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  queuedMessages?: string[];
  cancelQueuedMessage?: (index: number) => void;
  onOpenTaskDrawer?: () => void;
  onOpenActionHub?: () => void;
  onOpenMemoryInspector?: () => void;
  composeExtras: LawmindComposeExtras;
  streamCompactLabels?: string[];
};

export type LawmindChatMessagesColumnProps = Pick<
  LawmindChatWorkspaceProps,
  | "selectedAssistantId"
  | "currentMessages"
  | "copiedMessageIndex"
  | "loading"
  | "messagesEndRef"
  | "onCopyMessage"
  | "onApplyPrompt"
  | "onSendClarificationMessage"
  | "fileChatPills"
  | "onRemoveFileChatPill"
  | "onClearFileChatPills"
  | "contextTaskId"
  | "apiBase"
  | "onOpenReview"
  | "onDelegateAssist"
  | "delegateAssistEnabled"
  | "chatSessionId"
  | "onResumeRequiresAction"
> & {
  revisionBackgroundActive?: boolean;
  streamCompactLabels?: string[];
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
  revisionBackgroundActive,
  streamCompactLabels = [],
}: LawmindChatMessagesColumnProps) {
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [briefOnly, setBriefOnly] = useState(() => readBriefOnlyPreference());
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
      briefOnly,
      collapseSearch: true,
      groupTools: true,
    });
    const notices: RenderableChatItem[] = streamCompactLabels.map((label, i) => ({
      kind: "compact_notice" as const,
      label,
      sourceIndex: -1 - i,
    }));
    return notices.length > 0 ? [...notices, ...base] : base;
  }, [currentMessages, briefOnly, streamCompactLabels]);

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
        dimmed={dimmed}
      />
    );
  };

  return (
    <>
      {revisionBackgroundActive && contextTaskId?.trim() && onOpenReview ? (
        <div className="lm-chat-revision-banner" role="status">
          <span>正在后台修订草稿，执行过程见下方；完成后将自动回到审核台。</span>
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onOpenReview}>
            回审核台
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
        <label className="lm-messages-brief-toggle">
          <input
            type="checkbox"
            checked={briefOnly}
            onChange={(e) => {
              const next = e.target.checked;
              setBriefOnly(next);
              writeBriefOnlyPreference(next);
            }}
          />
          仅看交付相关
        </label>
        <LawmindChatHistorySearch items={renderableItems} onHighlightIndices={onHighlightIndices} />
      </div>
      <div
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
              用自然语言交办任务；可从左侧 cases/ 选择案件，或在下方选择常见场景。
            </p>
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
          <LawmindChatMessagesVirtualList
            count={renderableItems.length}
            enabled
            endRef={messagesEndRef}
          >
            {(virtualIndex) =>
              renderItem(
                renderableItems[virtualIndex],
                `${selectedAssistantId}-item-${virtualIndex}`,
              )
            }
          </LawmindChatMessagesVirtualList>
        )}
        <div ref={messagesEndRef} />
      </div>
    </>
  );
}

/** 底部输入区：始终显示在主工作区底栏（可拖高度） */
export function LawmindChatComposeFooter({
  currentMessages,
  input,
  loading,
  error,
  contextTaskId,
  contextMatterId,
  matterTitle,
  textareaRef,
  onInputChange,
  onSend,
  onAbortChat,
  onApplyPrompt,
  onClearContext,
  onOpenComposeSettings,
  onOpenSettings,
  onOpenDoctor,
  onOpenApiWizard,
  modelCatalog = [],
  selectedModelId = "",
  onModelSelect,
  composeModelHint,
  composeModelQuickTestBusy,
  onComposeModelQuickTest,
  onDelegateAssist,
  delegateAssistEnabled: _delegateAssistEnabled,
  allowWebSearch,
  webSearchPolicyBlocked,
  onAllowWebSearchChange,
  apiBase,
  chatSessionId: _chatSessionId,
  queuedMessages = [],
  cancelQueuedMessage,
  onOpenTaskDrawer,
  onOpenActionHub,
  onOpenMemoryInspector,
  onOpenReview,
  composeExtras,
  fileChatPills = [],
  onRemoveFileChatPill,
  onClearFileChatPills,
  onAddFileToChatContext,
  onContextMatterChange,
  composeMatterOptions = [],
  fileChatContextItems = [],
}: Pick<
  LawmindChatWorkspaceProps,
  | "currentMessages"
  | "input"
  | "loading"
  | "error"
  | "contextTaskId"
  | "contextMatterId"
  | "matterTitle"
  | "textareaRef"
  | "onInputChange"
  | "onSend"
  | "onAbortChat"
  | "onApplyPrompt"
  | "onClearContext"
  | "onOpenComposeSettings"
  | "onOpenSettings"
  | "onOpenDoctor"
  | "onOpenApiWizard"
  | "modelCatalog"
  | "selectedModelId"
  | "onModelSelect"
  | "composeModelHint"
  | "composeModelQuickTestBusy"
  | "onComposeModelQuickTest"
  | "onDelegateAssist"
  | "delegateAssistEnabled"
  | "allowWebSearch"
  | "webSearchPolicyBlocked"
  | "onAllowWebSearchChange"
  | "apiBase"
  | "chatSessionId"
  | "queuedMessages"
  | "cancelQueuedMessage"
  | "onOpenTaskDrawer"
  | "onOpenActionHub"
  | "onOpenMemoryInspector"
  | "onOpenReview"
  | "fileChatPills"
  | "onRemoveFileChatPill"
  | "onClearFileChatPills"
  | "onAddFileToChatContext"
  | "onContextMatterChange"
  | "composeMatterOptions"
  | "fileChatContextItems"
> & {
  composeExtras: LawmindComposeExtras;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [stashNotice, setStashNotice] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextPickerQuery, setContextPickerQuery] = useState("");
  const [contextPickerAtIndex, setContextPickerAtIndex] = useState(0);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const extras = composeExtras;

  useEffect(() => {
    if (!loading) {
      void extras.refreshContextBudget();
    }
  }, [loading, extras.refreshContextBudget]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!input.trim() && contextMatterId) {
      const stashed = readComposeStash(contextMatterId);
      if (stashed.trim()) {
        onInputChange(stashed);
        setStashNotice(true);
      }
    }
  }, [contextMatterId, input, onInputChange]);

  const paletteActions: CommandPaletteAction[] = useMemo(
    () => [
      {
        id: "doctor",
        slash: "/doctor",
        label: "系统体检",
        run: () => onOpenDoctor?.(),
      },
      {
        id: "review",
        slash: "/review",
        label: "审核台",
        hint: "打开审核工作台",
        run: () => onOpenReview?.(),
      },
      {
        id: "tasks",
        slash: "/tasks",
        label: "任务抽屉",
        run: () => onOpenTaskDrawer?.(),
      },
      {
        id: "hub",
        slash: "/hub",
        label: "待处理中心",
        run: () => onOpenActionHub?.(),
      },
      {
        id: "memory",
        slash: "/memory",
        label: "记忆库",
        run: () => onOpenMemoryInspector?.(),
      },
      {
        id: "delegate",
        slash: "/delegate",
        label: "交给其他助手",
        run: () => onDelegateAssist?.(),
      },
      {
        id: "contract",
        slash: "/contract",
        label: "合同审查",
        hint: "插入审查提示",
        run: () =>
          onApplyPrompt("请对以下合同进行逐条审查，并列出关键风险点与修改建议：\n\n"),
      },
      {
        id: "letter",
        slash: "/letter",
        label: "起草律师函",
        run: () => onApplyPrompt("请帮我起草一封律师函，就以下事项发出法律警告：\n\n"),
      },
      {
        id: "statute",
        slash: "/statute",
        label: "法规检索",
        run: () => onApplyPrompt("请检索以下法律问题的相关法规、司法解释与裁判要旨：\n\n"),
      },
      {
        id: "templates",
        slash: "/templates",
        label: "法律模板",
        hint: "从工作流模板带入提示",
        run: () => setTemplateGalleryOpen(true),
      },
      {
        id: "config",
        slash: "/config",
        label: "设置",
        run: () => (onOpenSettings ?? onOpenComposeSettings)?.(),
      },
    ],
    [
      onOpenComposeSettings,
      onOpenSettings,
      onOpenDoctor,
      onOpenTaskDrawer,
      onOpenMemoryInspector,
      onOpenReview,
      onOpenActionHub,
      onDelegateAssist,
      onApplyPrompt,
    ],
  );

  const { height: composeHeight, onResizePointerDown: onComposeResizePointerDown } = usePaneResizeVerticalPx({
    storageKey: "lawmind.ui.chatComposeHeight",
    defaultHeight: LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
    min: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
    max: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  });

  const pendingClarify = getPendingClarificationState(currentMessages);
  const scrollToClarifyCard = () => {
    if (pendingClarify.assistantMessageIndex < 0) {
      return;
    }
    const id = `lm-clarify-card-${pendingClarify.assistantMessageIndex}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const closeContextPicker = useCallback(() => {
    setContextPickerOpen(false);
    setContextPickerQuery("");
    setContextPickerAtIndex(0);
  }, []);

  const openContextPickerAtCursor = useCallback(() => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? input.length;
    setContextPickerAtIndex(cursor);
    const trigger = parseAtTrigger(input, cursor);
    setContextPickerQuery(trigger?.query ?? "");
    setContextPickerOpen(true);
  }, [input, textareaRef]);

  const handleComposeInputChange = useCallback(
    (value: string) => {
      onInputChange(value);
      writeComposeStash(contextMatterId, value);
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? value.length;
      const trigger = parseAtTrigger(value, cursor);
      if (trigger) {
        setContextPickerAtIndex(trigger.startIndex);
        setContextPickerQuery(trigger.query);
        setContextPickerOpen(true);
      } else if (contextPickerOpen && !value.includes("@")) {
        closeContextPicker();
      }
    },
    [onInputChange, contextMatterId, textareaRef, contextPickerOpen, closeContextPicker],
  );

  const finishContextPickerSelection = useCallback(() => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? input.length;
    const start = contextPickerAtIndex;
    const { nextInput, nextCursor } = removeAtTokenFromInput(input, start, cursor);
    onInputChange(nextInput);
    writeComposeStash(contextMatterId, nextInput);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCursor, nextCursor);
    });
    closeContextPicker();
  }, [
    textareaRef,
    input,
    contextPickerAtIndex,
    onInputChange,
    contextMatterId,
    closeContextPicker,
  ]);

  const handleSelectContextFile = useCallback(
    (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => {
      onAddFileToChatContext?.(payload);
      rememberFileContextPath(payload);
      finishContextPickerSelection();
    },
    [onAddFileToChatContext, finishContextPickerSelection],
  );

  const handleSelectContextMatter = useCallback(
    (matterId: string) => {
      onContextMatterChange?.(matterId);
      finishContextPickerSelection();
    },
    [onContextMatterChange, finishContextPickerSelection],
  );

  const handleSelectContextTemplate = useCallback(
    (template: { id: string; starterPrompt?: string }) => {
      if (template.starterPrompt?.trim()) {
        onApplyPrompt(template.starterPrompt.trim());
      }
      finishContextPickerSelection();
    },
    [onApplyPrompt, finishContextPickerSelection],
  );

  const clearMatterChip = useCallback(() => {
    if (contextTaskId) {
      return;
    }
    onContextMatterChange?.(null);
  }, [contextTaskId, onContextMatterChange]);

  return (
    <>
      <div
        className="lm-split-handle lm-split-handle-horizontal"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整输入区高度"
        title="拖动调整消息区与输入区比例"
        onPointerDown={onComposeResizePointerDown}
      />
      <div
        className="lm-compose lm-compose-resizable"
        style={{
          height: composeHeight,
          flexShrink: 0,
          minHeight: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
          maxHeight: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
        }}
      >
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
        {(composeModelHint?.trim() || composeModelQuickTestBusy) ? (
          <div className="lm-compose-model-hint" role="status">
            {composeModelQuickTestBusy && !(composeModelHint ?? "").trim()
              ? "正在测试模型连接…"
              : (composeModelHint ?? "").trim()}
          </div>
        ) : null}
        <LawmindRequiresActionStrip
          pendingApprovalCount={extras.pendingApprovalCount}
          clarificationPending={pendingClarify.pending}
          clarificationCount={pendingClarify.count}
          onOpenActionHub={onOpenActionHub}
          onScrollToClarify={scrollToClarifyCard}
        />
        {pendingClarify.pending && (
          <div className="lm-clarify-session-bar" role="status">
            <span className="lm-clarify-session-bar-text">
              {pendingClarify.count > 0
                ? `请先补全下面 ${pendingClarify.count} 项，我才能继续。`
                : "请先就上面的待确认点说清，我才能继续。"}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary lm-clarify-session-bar-jump" onClick={scrollToClarifyCard}>
              去填写处
            </button>
          </div>
        )}
        {contextMatterId && !contextTaskId ? (
          <div
            className="lm-context-banner"
            title={internalIdsTitle([{ label: "案件编号", value: contextMatterId }])}
          >
            <span>
              当前对话已关联案件。
              {matterTitle ? ` ${matterTitle}` : ""}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
              取消关联
            </button>
          </div>
        ) : null}
        {contextTaskId ? (
          <div
            className="lm-context-banner"
            title={internalIdsTitle([
              { label: "任务编号", value: contextTaskId },
              { label: "案件编号", value: contextMatterId ?? undefined },
            ])}
          >
            <span>
              当前对话已关联案件工作台中的一条草稿。
              {matterTitle ? `（${matterTitle}）` : ""}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
              不跟这个了
            </button>
          </div>
        ) : null}

        {queuedMessages.length > 0 ? (
          <div className="lm-compose-queue" role="status">
            <span className="lm-meta">排队中 {queuedMessages.length} 条</span>
            <ul>
              {queuedMessages.map((q, i) => (
                <li key={`q-${i}`}>
                  <span>{q.slice(0, 80)}</span>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-small"
                    onClick={() => cancelQueuedMessage?.(i)}
                  >
                    取消
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {stashNotice ? (
          <div className="lm-compose-stash" role="status">
            已恢复未发送草稿
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={() => setStashNotice(false)}>
              知道了
            </button>
          </div>
        ) : null}
        {extras.contextBudget ? (
          <div className="lm-compose-token-bar" role="status">
            上下文约 {extras.contextBudget.used} / {extras.contextBudget.effectiveLimit} tokens
            {extras.contextBudget.level === "warn" ? " · 接近上限" : ""}
            {extras.contextBudget.level === "compact" ? " · 建议压缩" : ""}
          </div>
        ) : null}
        <div className="lm-chip-row lm-chip-row-compose">
          {QUICK_ACTIONS.slice(0, 4).map((action) => (
            <button
              key={action.label}
              type="button"
              className="lm-chip"
              onClick={() => onApplyPrompt(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>

        <LawmindComposeAttachments
          filePills={fileChatPills}
          contextMatterId={contextTaskId ? null : contextMatterId}
          matterTitle={matterTitle}
          onRemoveFilePill={onRemoveFileChatPill}
          onClearFilePills={onClearFileChatPills}
          onClearMatter={contextTaskId ? undefined : clearMatterChip}
        />

        <div className="lm-compose-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleComposeInputChange(e.target.value)}
            placeholder="Enter 发送，Shift+Enter 换行；@ 添加上下文，/ 或 ⌘K 打开命令"
            title="用平常说话的方式写即可"
            onKeyDown={(e) => {
              if (contextPickerOpen && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter")) {
                e.preventDefault();
                return;
              }
              if (e.key === "/" && !input.trim()) {
                e.preventDefault();
                setCommandOpen(true);
                setCommandQuery("/");
                return;
              }
              handleEnterSendShiftNewline(e, () => void onSend());
            }}
          />
          <div className="lm-compose-toolbar" aria-label="模式、模型与发送">
            <div className="lm-compose-toolbar-start">
              <label className="lm-compose-bar-field">
                <span className="lm-compose-bar-label">模式</span>
                <select className="lm-compose-select" value="chat" aria-label="运行模式" title="Plan 等多步编排将陆续提供">
                  <option value="chat">对话</option>
                  <option value="plan" disabled>
                    Plan（即将推出）
                  </option>
                </select>
              </label>
              <label className="lm-compose-bar-field lm-compose-permission-mode">
                <span className="lm-compose-bar-label">权限</span>
                <select
                  className="lm-compose-select"
                  value={extras.permissionMode}
                  aria-label="工具权限模式"
                  disabled={loading}
                  onChange={(e) =>
                    extras.onPermissionModeChange(e.target.value as ComposePermissionMode)
                  }
                >
                  <option value="standard">标准</option>
                  <option value="strict">严格</option>
                  <option value="readonly">只读</option>
                </select>
              </label>
              <label className="lm-compose-bar-field">
                <span className="lm-compose-bar-label">联网</span>
                <select
                  className="lm-compose-select"
                  value={allowWebSearch ? "web" : "local"}
                  disabled={Boolean(webSearchPolicyBlocked) || loading}
                  aria-label="联网工具"
                  title={
                    webSearchPolicyBlocked
                      ? "工作区策略已禁止联网检索"
                      : allowWebSearch
                        ? "已开启：助手可调用 web_search（Brave）"
                        : "关闭：仅使用工作区、案件记忆与本地工具"
                  }
                  onChange={(e) => onAllowWebSearchChange(e.target.value === "web")}
                >
                  <option value="local">仅本地</option>
                  <option value="web">联网</option>
                </select>
              </label>
              <label className="lm-compose-bar-field">
                <span className="lm-compose-bar-label">模型</span>
                <LawmindModelPicker
                  catalog={modelCatalog}
                  selectedModelId={selectedModelId}
                  onSelect={(id) => onModelSelect?.(id)}
                  onOpenSettings={onOpenComposeSettings}
                  onOpenApiWizard={onOpenApiWizard}
                  onTestCurrent={onComposeModelQuickTest}
                  quickTestBusy={composeModelQuickTestBusy}
                  disabled={loading}
                  disabledTitle={loading ? "回复生成中，请稍后再切换模型" : undefined}
                />
              </label>
            </div>
            <div className="lm-compose-toolbar-end">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-small"
                title="添加上下文（@）"
                aria-label="添加上下文"
                onClick={openContextPickerAtCursor}
              >
                @
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-small"
                title="写文稿 / 做材料"
                aria-label="打开写文稿或做材料模板"
                onClick={() => setTemplateGalleryOpen(true)}
              >
                写材料
              </button>
              {extras.pendingApprovalCount > 0 ? (
                <button
                  type="button"
                  className="lm-compose-pending-badge"
                  title="打开待办中心"
                  onClick={() => onOpenActionHub?.()}
                >
                  待批准 {extras.pendingApprovalCount}
                </button>
              ) : null}
              {loading ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-chat-stop-btn"
                  onClick={() => onAbortChat?.()}
                >
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  className="lm-btn"
                  disabled={!input.trim()}
                  title={!input.trim() ? "请输入内容后再发送" : undefined}
                  onClick={() => void onSend()}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <LawmindComposeContextPicker
        open={contextPickerOpen}
        query={contextPickerQuery}
        apiBase={apiBase}
        contextMatterId={contextMatterId}
        pinnedFiles={fileChatContextItems}
        matters={composeMatterOptions}
        onSelectFile={handleSelectContextFile}
        onSelectMatter={handleSelectContextMatter}
        onSelectTemplate={handleSelectContextTemplate}
        onClose={closeContextPicker}
      />
      <LawmindComposeTemplateGallery
        open={templateGalleryOpen}
        apiBase={apiBase}
        onClose={() => setTemplateGalleryOpen(false)}
        onApplyStarterPrompt={onApplyPrompt}
      />
      <LawmindCommandPalette
        open={commandOpen}
        onClose={() => {
          setCommandOpen(false);
          setCommandQuery("");
        }}
        actions={paletteActions}
        query={commandQuery}
        onQueryChange={setCommandQuery}
      />
    </>
  );
}

export function LawmindChatShell(props: LawmindChatWorkspaceProps) {
  return (
    <div className="lm-chat-workspace">
      <LawmindChatMessagesColumn {...props} />
      <LawmindChatComposeFooter
        composeExtras={props.composeExtras}
        currentMessages={props.currentMessages}
        input={props.input}
        loading={props.loading}
        error={props.error}
        contextTaskId={props.contextTaskId}
        contextMatterId={props.contextMatterId}
        matterTitle={props.matterTitle}
        textareaRef={props.textareaRef}
        onInputChange={props.onInputChange}
        onSend={props.onSend}
        onAbortChat={props.onAbortChat}
        onApplyPrompt={props.onApplyPrompt}
        onClearContext={props.onClearContext}
        onOpenComposeSettings={props.onOpenComposeSettings}
        onOpenSettings={props.onOpenSettings}
        onOpenDoctor={props.onOpenDoctor}
        onOpenApiWizard={props.onOpenApiWizard}
        modelCatalog={props.modelCatalog}
        selectedModelId={props.selectedModelId}
        onModelSelect={props.onModelSelect}
        composeModelHint={props.composeModelHint}
        composeModelQuickTestBusy={props.composeModelQuickTestBusy}
        onComposeModelQuickTest={props.onComposeModelQuickTest}
        onDelegateAssist={props.onDelegateAssist}
        delegateAssistEnabled={props.delegateAssistEnabled}
        allowWebSearch={props.allowWebSearch}
        webSearchPolicyBlocked={props.webSearchPolicyBlocked}
        onAllowWebSearchChange={props.onAllowWebSearchChange}
        apiBase={props.apiBase}
        chatSessionId={props.chatSessionId}
        queuedMessages={props.queuedMessages}
        cancelQueuedMessage={props.cancelQueuedMessage}
        onOpenTaskDrawer={props.onOpenTaskDrawer}
        onOpenActionHub={props.onOpenActionHub}
        onOpenMemoryInspector={props.onOpenMemoryInspector}
        onOpenReview={props.onOpenReview}
        fileChatPills={props.fileChatPills}
        onRemoveFileChatPill={props.onRemoveFileChatPill}
        onClearFileChatPills={props.onClearFileChatPills}
        onAddFileToChatContext={props.onAddFileToChatContext}
        onContextMatterChange={props.onContextMatterChange}
        composeMatterOptions={props.composeMatterOptions}
        fileChatContextItems={props.fileChatContextItems}
      />
    </div>
  );
}
