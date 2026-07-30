import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LawmindCommandPalette, type CommandPaletteAction } from "./LawmindCommandPalette";
import {
  readComposePermissionMode,
  readComposeStash,
  readExecutePermissionMode,
  writeComposeStash,
} from "./lawmind-compose-prefs";
import type { LawmindComposeExtras } from "./useLawmindComposeExtras";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "./lawmind-requires-action";
import { handleEnterSendShiftNewline, type ChatMsg } from "./lawmind-chat";
import {
  LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
  LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
} from "./lawmind-panel-layout";
import { usePaneResizeVerticalPx } from "./use-pane-resize";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { LawmindChatComposeChrome } from "./lawmind-chat-compose-chrome";
import { LawmindChatComposeToolbar } from "./lawmind-chat-compose-toolbar";
import {
  buildExecuteConfirmPrompt,
  clearPlanHandoff,
  deleteSessionPlanHandoff,
  extractPlanHandoffText,
  isExecuteConfirmPrompt,
  planHandoffSummary,
  pushSessionPlanHandoff,
  readPlanHandoff,
  reconcilePlanHandoffWithServer,
  shouldInjectExecuteHandoff,
  syncPlanHandoffFromMessages,
  writePlanHandoff,
} from "./lawmind-plan-handoff";
import { LawmindComposeContextPicker } from "./LawmindComposeContextPicker";
import { LawmindComposeTemplateGallery } from "./LawmindComposeTemplateGallery";
import type { ReviewOpenTarget } from "./LawmindChatReviewSticky";
import type { FileChatContextItem } from "./lawmind-app-shell";
import type { TruthSourceContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import {
  parseAtTrigger,
  rememberFileContextPath,
  removeAtTokenFromInput,
  type ComposeContextMatterOption,
} from "./lawmind-compose-context";

export { hasChatDiagnostics } from "./lawmind-chat";
import {
  LawmindChatMessagesColumn,
  type LawmindChatMessagesColumnProps,
} from "./lawmind-chat-messages-column";
export { LawmindChatMessagesColumn, type LawmindChatMessagesColumnProps };

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
  /** Brave 密钥未配置时禁用联网下拉 */
  webSearchApiKeyConfigured?: boolean;
  contextTaskId: string | null;
  contextMatterId: string | null;
  apiBase?: string;
  onOpenReview?: (target?: ReviewOpenTarget) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onAllowWebSearchChange: (value: boolean) => void;
  onSend: () => void | Promise<void>;
  /** 请求进行中时中止当前对话请求（与「发送」同位切换为「停止」） */
  onAbortChat?: () => void;
  onDeleteChatMessage?: (uiIndex: number) => void | Promise<void>;
  onEditChatMessage?: (uiIndex: number, nextText: string) => void | Promise<void>;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onApplyPrompt: (prompt: string) => void;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  /** Structured「填表交办」: send without requiring the composer textbox. */
  onDispatchJob?: (prompt: string) => void | Promise<void>;
  onClearContext: () => void;
  /** 关联案件标题（可空） */
  matterTitle: string | null;
  /** 在「文件」页标记的、将拼入发送给模型的路径引用 */
  fileChatPills: Array<{ id: string; shortLabel: string; title: string; relPath?: string }>;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  onAddFileToChatContext?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onAddComposeTruthPin?: (pin: TruthSourceContextPin) => void;
  onContextMatterChange?: (matterId: string | null) => void;
  composeMatterOptions?: ComposeContextMatterOption[];
  fileChatContextItems?: FileChatContextItem[];
  composeTruthPins?: TruthSourceContextPin[];
  truthPills?: Array<{ id: string; shortLabel: string; title: string }>;
  onRemoveTruthPill?: (id: string) => void;
  onClearTruthPills?: () => void;
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
  /** Opens「在办」with needs-decision focus. */
  onOpenNeedsDecisionDesk?: (
    target?: import("./lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: (
    target?: import("./lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  onOpenMemoryInspector?: () => void;
  composeExtras: LawmindComposeExtras;
  streamCompactLabels?: string[];
};

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
  onDispatchJob,
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
  composeModelConfigured,
  onDelegateAssist,
  delegateAssistEnabled: _delegateAssistEnabled,
  allowWebSearch,
  webSearchPolicyBlocked,
  webSearchApiKeyConfigured,
  onAllowWebSearchChange,
  apiBase,
  chatSessionId,
  queuedMessages = [],
  cancelQueuedMessage,
  onOpenTaskDrawer,
  onOpenNeedsDecisionDesk,
  onOpenActionHub,
  onOpenMemoryInspector,
  onOpenReview,
  composeExtras,
  fileChatPills = [],
  onRemoveFileChatPill,
  onClearFileChatPills,
  onAddFileToChatContext,
  onAddComposeTruthPin,
  onContextMatterChange,
  composeMatterOptions = [],
  fileChatContextItems = [],
  composeTruthPins = [],
  truthPills = [],
  onRemoveTruthPill,
  onClearTruthPills,
  templateGalleryOpen: templateGalleryOpenProp,
  onTemplateGalleryOpenChange,
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
  | "onDispatchJob"
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
  | "composeModelConfigured"
  | "onDelegateAssist"
  | "delegateAssistEnabled"
  | "allowWebSearch"
  | "webSearchPolicyBlocked"
  | "webSearchApiKeyConfigured"
  | "onAllowWebSearchChange"
  | "apiBase"
  | "chatSessionId"
  | "queuedMessages"
  | "cancelQueuedMessage"
  | "onOpenTaskDrawer"
  | "onOpenNeedsDecisionDesk"
  | "onOpenActionHub"
  | "onOpenMemoryInspector"
  | "onOpenReview"
  | "fileChatPills"
  | "onRemoveFileChatPill"
  | "onClearFileChatPills"
  | "onAddFileToChatContext"
  | "onAddComposeTruthPin"
  | "onContextMatterChange"
  | "composeMatterOptions"
  | "fileChatContextItems"
  | "composeTruthPins"
  | "truthPills"
  | "onRemoveTruthPill"
  | "onClearTruthPills"
> & {
  composeExtras: LawmindComposeExtras;
  templateGalleryOpen?: boolean;
  onTemplateGalleryOpenChange?: (open: boolean) => void;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextPickerQuery, setContextPickerQuery] = useState("");
  const [contextPickerAtIndex, setContextPickerAtIndex] = useState(0);
  const [planHandoffText, setPlanHandoffText] = useState<string | null>(null);
  const [templateGalleryOpenLocal, setTemplateGalleryOpenLocal] = useState(false);
  const templateGalleryOpen = templateGalleryOpenProp ?? templateGalleryOpenLocal;
  const setTemplateGalleryOpen = (open: boolean) => {
    onTemplateGalleryOpenChange?.(open);
    if (templateGalleryOpenProp === undefined) {
      setTemplateGalleryOpenLocal(open);
    }
  };
  const openNeedsDecisionDesk = onOpenNeedsDecisionDesk ?? onOpenActionHub;
  const extras = composeExtras;
  const pendingDecisionTotal =
    extras.actionSummary?.requiresDecisionTotal ?? extras.actionSummary?.total ?? 0;

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
      }
    }
  }, [contextMatterId, input, onInputChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const merged = await reconcilePlanHandoffWithServer(apiBase, chatSessionId);
      if (!cancelled) {
        setPlanHandoffText(merged?.planText ?? readPlanHandoff(chatSessionId)?.planText ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, chatSessionId]);

  useEffect(() => {
    if (!chatSessionId) {
      return;
    }
    const mode = extras.permissionMode || readComposePermissionMode();
    if (mode !== "readonly") {
      return;
    }
    const synced = syncPlanHandoffFromMessages(chatSessionId, currentMessages);
    if (synced?.planText) {
      setPlanHandoffText(synced.planText);
      if (apiBase) {
        void pushSessionPlanHandoff(apiBase, chatSessionId, synced.planText, synced.updatedAt);
      }
    }
  }, [apiBase, chatSessionId, currentMessages, extras.permissionMode]);

  const persistPlanLocalAndRemote = useCallback(
    (plan: string) => {
      if (!plan.trim()) {
        return;
      }
      writePlanHandoff(chatSessionId, plan);
      setPlanHandoffText(plan);
      if (apiBase && chatSessionId) {
        void pushSessionPlanHandoff(apiBase, chatSessionId, plan);
      }
    },
    [apiBase, chatSessionId],
  );

  const fillPlanHandoff = useCallback(() => {
    extras.onPermissionModeChange("standard");
    const plan =
      planHandoffText?.trim() ||
      extractPlanHandoffText(currentMessages) ||
      readPlanHandoff(chatSessionId)?.planText ||
      "";
    persistPlanLocalAndRemote(plan);
    onInputChange(buildExecuteConfirmPrompt(plan));
  }, [
    chatSessionId,
    currentMessages,
    extras,
    onInputChange,
    persistPlanLocalAndRemote,
    planHandoffText,
  ]);

  const dismissPlanHandoff = useCallback(() => {
    clearPlanHandoff(chatSessionId);
    setPlanHandoffText(null);
    if (apiBase && chatSessionId) {
      void deleteSessionPlanHandoff(apiBase, chatSessionId);
    }
  }, [apiBase, chatSessionId]);

  const startExecuteFromPlan = useCallback(() => {
    extras.onPermissionModeChange(readExecutePermissionMode());
    const plan =
      extractPlanHandoffText(currentMessages) ||
      planHandoffText ||
      readPlanHandoff(chatSessionId)?.planText ||
      "";
    persistPlanLocalAndRemote(plan);
    if (!shouldInjectExecuteHandoff(input)) {
      return;
    }
    onInputChange(buildExecuteConfirmPrompt(plan));
  }, [
    chatSessionId,
    currentMessages,
    extras,
    input,
    onInputChange,
    persistPlanLocalAndRemote,
    planHandoffText,
  ]);

  const handleComposeSend = useCallback(() => {
    if (isExecuteConfirmPrompt(input)) {
      clearPlanHandoff(chatSessionId);
      setPlanHandoffText(null);
      if (apiBase && chatSessionId) {
        void deleteSessionPlanHandoff(apiBase, chatSessionId);
      }
    }
    return onSend();
  }, [apiBase, chatSessionId, input, onSend]);

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
        label: "文书台",
        hint: "打开文书撰写与预览",
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
        label: pendingDecisionTotal > 0 ? `待我拍板 (${pendingDecisionTotal})` : "待我拍板",
        hint: "跨会话收件箱：澄清、批准、待审文书",
        run: () => openNeedsDecisionDesk?.(),
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
      openNeedsDecisionDesk,
      onDelegateAssist,
      onApplyPrompt,
      pendingDecisionTotal,
    ],
  );

  const { height: composeHeight, onResizePointerDown: onComposeResizePointerDown } = usePaneResizeVerticalPx({
    // v3: shorter default compose so message list gets more vertical space
    storageKey: "lawmind.ui.chatComposeHeight.v3",
    defaultHeight: LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
    min: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
    max: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  });

  const closeContextPicker = useCallback(() => {
    setContextPickerOpen(false);
    setContextPickerQuery("");
    setContextPickerAtIndex(0);
  }, []);

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

  const handleSelectContextTruthPin = useCallback(
    (pin: TruthSourceContextPin) => {
      onAddComposeTruthPin?.(pin);
      finishContextPickerSelection();
    },
    [onAddComposeTruthPin, finishContextPickerSelection],
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
    if (onContextMatterChange) {
      onContextMatterChange(null);
      return;
    }
    // Fallback when parent only wired onClearContext (matter-only unlink).
    onClearContext();
  }, [contextTaskId, onContextMatterChange, onClearContext]);

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
      {/* Chrome above the reserved input height — must not eat composeHeight. */}
      <LawmindChatComposeChrome
        error={error}
        apiBase={apiBase}
        composeModelConfigured={composeModelConfigured}
        onOpenApiWizard={onOpenApiWizard}
        onOpenComposeSettings={onOpenComposeSettings}
        composeModelHint={composeModelHint}
        composeModelQuickTestBusy={composeModelQuickTestBusy}
        composeInput={input}
        queuedMessages={queuedMessages}
        cancelQueuedMessage={cancelQueuedMessage}
        fileChatPills={fileChatPills}
        truthPills={truthPills}
        contextMatterId={contextMatterId}
        contextTaskId={contextTaskId}
        matterTitle={matterTitle}
        onRemoveFileChatPill={onRemoveFileChatPill}
        onRemoveTruthPill={onRemoveTruthPill}
        onClearFileChatPills={onClearFileChatPills}
        onClearTruthPills={onClearTruthPills}
        onClearMatter={contextTaskId ? undefined : clearMatterChip}
        onClearTask={contextTaskId ? onClearContext : undefined}
        planHandoffSummary={planHandoffText ? planHandoffSummary(planHandoffText) : null}
        onFillPlanHandoff={planHandoffText ? fillPlanHandoff : undefined}
        onClearPlanHandoff={planHandoffText ? dismissPlanHandoff : undefined}
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
        <div className="lm-compose-box">
          <textarea
            ref={textareaRef}
            value={input}
            aria-label="消息输入"
            onChange={(e) => handleComposeInputChange(e.target.value)}
            placeholder="输入您的问题，或输入 / 选择技能；Enter 发送，Shift+Enter 换行"
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
              handleEnterSendShiftNewline(e, () => void handleComposeSend());
            }}
          />
          <LawmindChatComposeToolbar
            loading={loading}
            input={input}
            onSend={handleComposeSend}
            onAbortChat={onAbortChat}
            permissionMode={extras.permissionMode}
            onPermissionModeChange={extras.onPermissionModeChange}
            onStartExecuteFromPlan={startExecuteFromPlan}
            allowWebSearch={allowWebSearch}
            webSearchPolicyBlocked={webSearchPolicyBlocked}
            webSearchApiKeyConfigured={webSearchApiKeyConfigured}
            onAllowWebSearchChange={onAllowWebSearchChange}
            modelCatalog={modelCatalog}
            selectedModelId={selectedModelId}
            onModelSelect={onModelSelect}
            onOpenComposeSettings={onOpenComposeSettings}
            onOpenApiWizard={onOpenApiWizard}
            onComposeModelQuickTest={onComposeModelQuickTest}
            composeModelQuickTestBusy={composeModelQuickTestBusy}
            onOpenWriteMaterials={() => setTemplateGalleryOpen(true)}
            contextBudget={extras.contextBudget}
            compactBusy={extras.compactBusy}
            compactHint={extras.compactHint}
            onCompactContext={() => void extras.compactSession()}
            onDistillLearning={() => void extras.distillSessionLearning()}
            onPreviewCompact={() => extras.previewCompact()}
            onOpenMemoryInspector={onOpenMemoryInspector}
          />
        </div>
      </div>
      <LawmindComposeContextPicker
        open={contextPickerOpen}
        query={contextPickerQuery}
        apiBase={apiBase}
        contextMatterId={contextMatterId}
        pinnedFiles={fileChatContextItems}
        pinnedTruthPins={composeTruthPins}
        matters={composeMatterOptions}
        onSelectFile={handleSelectContextFile}
        onSelectTruthPin={handleSelectContextTruthPin}
        onSelectMatter={handleSelectContextMatter}
        onSelectTemplate={handleSelectContextTemplate}
        onClose={closeContextPicker}
      />
      <LawmindComposeTemplateGallery
        open={templateGalleryOpen}
        apiBase={apiBase}
        onClose={() => setTemplateGalleryOpen(false)}
        onApplyStarterPrompt={onApplyPrompt}
        onDispatchJob={onDispatchJob}
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
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const openNeedsDecisionDesk = props.onOpenNeedsDecisionDesk ?? props.onOpenActionHub;
  return (
    <div className="lm-chat-workspace">
      <LawmindChatMessagesColumn
        {...props}
        onOpenNeedsDecisionDesk={openNeedsDecisionDesk}
        onOpenWriteMaterials={() => setTemplateGalleryOpen(true)}
      />
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
        onDispatchJob={props.onDispatchJob ?? props.onSendClarificationMessage}
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
        composeModelConfigured={props.composeModelConfigured}
        onDelegateAssist={props.onDelegateAssist}
        delegateAssistEnabled={props.delegateAssistEnabled}
        allowWebSearch={props.allowWebSearch}
        webSearchPolicyBlocked={props.webSearchPolicyBlocked}
        webSearchApiKeyConfigured={props.webSearchApiKeyConfigured}
        onAllowWebSearchChange={props.onAllowWebSearchChange}
        apiBase={props.apiBase}
        chatSessionId={props.chatSessionId}
        queuedMessages={props.queuedMessages}
        cancelQueuedMessage={props.cancelQueuedMessage}
        onOpenTaskDrawer={props.onOpenTaskDrawer}
        onOpenNeedsDecisionDesk={openNeedsDecisionDesk}
        onOpenMemoryInspector={props.onOpenMemoryInspector}
        onOpenReview={props.onOpenReview}
        fileChatPills={props.fileChatPills}
        onRemoveFileChatPill={props.onRemoveFileChatPill}
        onClearFileChatPills={props.onClearFileChatPills}
        onAddFileToChatContext={props.onAddFileToChatContext}
        onAddComposeTruthPin={props.onAddComposeTruthPin}
        onContextMatterChange={props.onContextMatterChange}
        composeMatterOptions={props.composeMatterOptions}
        fileChatContextItems={props.fileChatContextItems}
        composeTruthPins={props.composeTruthPins}
        truthPills={props.truthPills}
        onRemoveTruthPill={props.onRemoveTruthPill}
        onClearTruthPills={props.onClearTruthPills}
        templateGalleryOpen={templateGalleryOpen}
        onTemplateGalleryOpenChange={setTemplateGalleryOpen}
      />
    </div>
  );
}
