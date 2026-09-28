import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useSettingsPanelStore } from "./stores/settings-panel-store";
import {
  appendChatMessage,
  dropTrailingUserMessageIfText,
  isFetchAbortError,
  sendChatTurnStream,
  type ChatMsg,
} from "./lawmind-chat";
import {
  fetchContractRevisionIndexPrefix,
  shouldAttachContractRevisionIndex,
} from "./lawmind-contract-chat-context";
import {
  apiSendJson,
  errorMessage,
  isModelFailureError,
  MODEL_NOT_CONFIGURED_USER_HINT,
} from "./api-client";
import {
  blockSendForUnconfiguredCatalogRow,
  isActiveModelVerified,
  MODEL_NOT_VERIFIED_HINT,
} from "./lawmind-model-verify";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { LawmindHealthState } from "./lawmind-app-shell";
import type { FileChatContextItem } from "./lawmind-app-shell";
import { buildContextPinsPayload } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import type { TruthSourceContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import {
  buildFileContextMessagePrefix,
  fetchFileChatExcerpts,
  makeFileContextItemId,
} from "./lawmind-file-chat-context";
import { resolveImplicitWordPinsForChat } from "./lawmind-active-word-file";
import {
  appendActivityDelta,
  appendActivityToolProgress,
  createEmptyActivity,
  endActivityTool,
  finalizeActivity,
  finalizeActivityFailed,
  startActivityTool,
  textFromActivity,
} from "./lawmind-chat-activity.js";
import {
  noticeFromToolAuthorityGap,
  noticeFromToolDemoCorpus,
} from "./lawmind-authority-gap-notice";
import {
  applyRoundStart,
  applyToolEnd,
  applyVerifyGap,
  applyToolProgress,
  applyToolStart,
  createEmptyLiveTrace,
  finalizeLiveTrace,
  finalizeLiveTraceFailed,
} from "./lawmind-chat-trace.js";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { chatSessionStoreKey, persistActiveChatSessionId } from "./useLawmindChatShell";
import { readComposePermissionMode, writeComposeStash } from "./lawmind-compose-prefs";
import {
  FORK_CONTINUE_WORK_MESSAGE,
  parseForkContinueRequest,
} from "../../../../src/lawmind/agent/fork-continue-request.ts";
import { planTranscriptMutate } from "../../../../src/lawmind/agent/resolve-transcript-cut.ts";
import {
  abortSessionTurn,
  fetchSessionBubbles,
  mutateSessionMessages,
} from "./lawmind-chat-message-mutate";
import { retitlePlaceholderChatSession } from "./lawmind-chat-session-list";
import type { ChatSessionListEntry } from "./lawmind-chat-active-storage";
import {
  clientHasLiveTurn,
  focusedSessionHasLiveTurn,
  reattachLiveTurn,
  runningSessionIds,
  sessionQueueKey,
  setRunningChatSessionIds,
  shouldDetachLiveTurn,
  turnStillOwnsComposer,
  type FocusedChat,
  type LiveTurn,
} from "./lawmind-live-turns";

export type UseLawmindChatSendInput = {
  config: AppConfig | null;
  health: LawmindHealthState;
  input: string;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setShowWizard: Dispatch<SetStateAction<boolean>>;
  setComposeModelHint: Dispatch<SetStateAction<string | null>>;
  selectedAssistantId: string;
  selectedModelId: string;
  modelCatalog: ModelCatalogEntry[];
  sessionByAssistant: Record<string, string | undefined>;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  messagesByAssistant: Record<string, ChatMsg[]>;
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  contextMatterId: string | null;
  contextTaskId: string | null;
  fileChatContextItems: FileChatContextItem[];
  composeTruthPins: TruthSourceContextPin[];
  deskContractBatchDir: string;
  projectDir: string | null;
  allowWebSearch: boolean;
  refreshChatSessionListForAssistant: (assistantId: string) => Promise<unknown>;
  /** 发送当下把占位标题换成这句话，左栏不用等本轮结束。 */
  setChatSessionList?: Dispatch<SetStateAction<ChatSessionListEntry[]>>;
  refreshLists: () => Promise<void>;
  refreshAssistants: () => Promise<void>;
  refreshCollaboration: () => Promise<void>;
  applyStreamTokenBudget?: (info: {
    used: number;
    effectiveLimit: number;
    level: string;
  }) => void;
  onStreamCompactBoundary?: (info: {
    sessionSummaryPath?: string;
    droppedMessageCount?: number;
    overflowPrune?: boolean;
    firstKeptTimestamp?: string;
    digestCharCount?: number;
    boundaryId?: string;
    midTurn?: boolean;
    roundIndex?: number;
  }) => void;
  onStreamToolBudget?: (info: { used: number; maxToolCalls: number }) => void;
  /** 退让被反弹：本 hook 已负责清掉气泡里那句推诿。 */
  onStreamContextDeferralBounce?: (info: { roundIndex: number; bounceCount: number }) => void;
  /** After a turn finishes (success or failure) — e.g. refresh action-summary / sticky review. */
  onTurnComplete?: (info: { toolNames: string[] }) => void;
  /** Reload a session transcript after the lawyer returns to a background turn. */
  loadSessionMessagesIntoState?: (assistantId: string, sessionId: string) => Promise<boolean>;
  /** Filled so session switches can detach the visible transcript without aborting the turn. */
  noteFocusedChatSessionRef?: MutableRefObject<
    (focus: { assistantId: string; sessionId: string | undefined }) => void
  >;
  /** Filled so deleting a conversation stops its live turn. */
  abortLiveChatSessionRef?: MutableRefObject<(sessionId: string) => void>;
  /** True when this window still holds the SSE for that conversation. */
  hasLiveClientTurnRef?: MutableRefObject<(sessionId: string) => boolean>;
  /** Paint a background turn again after its transcript is reloaded. */
  reattachLiveChatSessionRef?: MutableRefObject<(sessionId: string) => void>;
  /**
   * 律师要求另起新对话并带上文时，在送给模型之前执行 fork。
   * 未接线时保持原样（把原话送进当前回合）。
   */
  forkContinueRef?: MutableRefObject<ForkContinueHandler | null>;
};

export type ForkContinueOutcome =
  | { ok: true; sessionId: string }
  | { ok: false; message: string };

export type ForkContinueHandler = (sourceSessionId: string) => Promise<ForkContinueOutcome>;

export function useLawmindChatSend(opts: UseLawmindChatSendInput) {
  const {
    config,
    health,
    input: composeInput,
    loading,
    setLoading,
    setError,
    setInput,
    setShowWizard,
    setComposeModelHint,
    selectedAssistantId,
    selectedModelId,
    modelCatalog,
    sessionByAssistant,
    setSessionByAssistant,
    messagesByAssistant,
    setMessagesByAssistant,
    contextMatterId,
    contextTaskId,
    fileChatContextItems,
    composeTruthPins,
    deskContractBatchDir,
    projectDir,
    allowWebSearch,
    refreshChatSessionListForAssistant,
    setChatSessionList,
    refreshLists,
    refreshAssistants,
    refreshCollaboration,
    applyStreamTokenBudget,
    onStreamCompactBoundary,
    onStreamContextDeferralBounce,
    onStreamToolBudget,
    onTurnComplete,
    loadSessionMessagesIntoState,
    noteFocusedChatSessionRef,
    abortLiveChatSessionRef,
    hasLiveClientTurnRef,
    reattachLiveChatSessionRef,
    forkContinueRef,
  } = opts;

  const liveTurnsRef = useRef<Map<string, LiveTurn>>(new Map());
  const turnSeqRef = useRef(0);
  const queuesRef = useRef<Map<string, string[]>>(new Map());
  const sendQueueRef = useRef<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const selectedAssistantIdRef = useRef(selectedAssistantId);
  const sessionByAssistantRef = useRef(sessionByAssistant);
  sessionByAssistantRef.current = sessionByAssistant;
  const focusedSessionRef = useRef<string | undefined>(sessionByAssistant[selectedAssistantId]);
  const focusOverrideRef = useRef<FocusedChat | null>(null);
  const sendChatMessageRef = useRef<
    (
      rawText: string,
      opts2?: {
        fromQueue?: boolean;
        /** Deliver this follow-up to a conversation that is not on screen. */
        background?: { assistantId: string; sessionId: string };
        /** 已经在承前分叉之后，禁止再把续办句识别成另一次分叉。 */
        forkHop?: boolean;
      },
    ) => Promise<void>
  >(async () => {});
  if (
    focusOverrideRef.current &&
    selectedAssistantId === focusOverrideRef.current.assistantId &&
    sessionByAssistant[focusOverrideRef.current.assistantId] === focusOverrideRef.current.sessionId
  ) {
    focusOverrideRef.current = null;
  }
  if (focusOverrideRef.current) {
    selectedAssistantIdRef.current = focusOverrideRef.current.assistantId;
    focusedSessionRef.current = focusOverrideRef.current.sessionId;
  } else {
    selectedAssistantIdRef.current = selectedAssistantId;
    focusedSessionRef.current = sessionByAssistant[selectedAssistantId];
  }

  const publishRunning = useCallback(() => {
    setRunningChatSessionIds(runningSessionIds(liveTurnsRef.current.values()));
  }, []);

  const currentFocus = useCallback((): FocusedChat => {
    return {
      assistantId: selectedAssistantIdRef.current,
      sessionId: focusedSessionRef.current,
    };
  }, []);

  const syncVisibleQueue = useCallback((focus: FocusedChat) => {
    const key = sessionQueueKey(focus.sessionId, focus.assistantId);
    const queued = queuesRef.current.get(key) ?? [];
    sendQueueRef.current = queued;
    setQueuedMessages(queued);
  }, []);

  const rememberQueue = useCallback((focus: FocusedChat, next: string[]) => {
    const key = sessionQueueKey(focus.sessionId, focus.assistantId);
    queuesRef.current.set(key, next);
    if (
      selectedAssistantIdRef.current === focus.assistantId &&
      focusedSessionRef.current === focus.sessionId
    ) {
      sendQueueRef.current = next;
      setQueuedMessages(next);
    }
  }, []);

  const abortLiveSession = useCallback(
    (sessionId: string) => {
      const id = sessionId.trim();
      if (!id) {
        return;
      }
      for (const turn of liveTurnsRef.current.values()) {
        if (turn.boundSessionId !== id) {
          continue;
        }
        if (config?.apiBase) {
          void abortSessionTurn(config.apiBase, id);
        }
        turn.abort.abort();
      }
    },
    [config?.apiBase],
  );

  const noteFocusedChatSession = useCallback(
    (focus: FocusedChat) => {
      focusOverrideRef.current = focus;
      selectedAssistantIdRef.current = focus.assistantId;
      focusedSessionRef.current = focus.sessionId;
      for (const turn of liveTurnsRef.current.values()) {
        if (shouldDetachLiveTurn(turn, focus)) {
          turn.uiDetached = true;
        }
      }
      syncVisibleQueue(focus);
      setLoading(focusedSessionHasLiveTurn(liveTurnsRef.current.values(), focus));
      publishRunning();
    },
    [publishRunning, setLoading, syncVisibleQueue],
  );

  if (noteFocusedChatSessionRef) {
    noteFocusedChatSessionRef.current = noteFocusedChatSession;
  }
  if (abortLiveChatSessionRef) {
    abortLiveChatSessionRef.current = abortLiveSession;
  }
  if (hasLiveClientTurnRef) {
    hasLiveClientTurnRef.current = (sessionId: string) =>
      clientHasLiveTurn(liveTurnsRef.current.values(), sessionId);
  }
  if (reattachLiveChatSessionRef) {
    reattachLiveChatSessionRef.current = (sessionId: string) => {
      const focus = {
        assistantId: selectedAssistantIdRef.current,
        sessionId,
      };
      if (!reattachLiveTurn(liveTurnsRef.current.values(), focus)) {
        return;
      }
      setLoading(true);
    };
  }

  const abortChatSend = useCallback(() => {
    const focus = currentFocus();
    const sessionId = focus.sessionId;
    if (config?.apiBase && sessionId) {
      void abortSessionTurn(config.apiBase, sessionId);
    }
    const taskId = contextTaskId?.trim();
    if (config?.apiBase && taskId) {
      void apiSendJson(config.apiBase, `/api/jobs/${encodeURIComponent(taskId)}/cancel`, "POST", {}).catch(
        () => undefined,
      );
    }
    for (const turn of liveTurnsRef.current.values()) {
      if (turn.assistantId !== focus.assistantId) {
        continue;
      }
      const matches =
        (sessionId && turn.boundSessionId === sessionId) ||
        (!sessionId && turn.boundSessionId == null && !turn.uiDetached);
      if (matches) {
        turn.abort.abort();
      }
    }
  }, [config?.apiBase, contextTaskId, currentFocus]);

  const applyMutatedMessages = useCallback(
    (assistantId: string, messages: ChatMsg[]) => {
      setMessagesByAssistant((previous) => ({ ...previous, [assistantId]: messages }));
    },
    [setMessagesByAssistant],
  );

  const deleteChatMessageAt = useCallback(
    async (uiIndex: number) => {
      if (!config?.apiBase || loading) {
        return;
      }
      const sessionId = sessionByAssistant[selectedAssistantId];
      if (!sessionId) {
        return;
      }
      const clientMessages = messagesByAssistant[selectedAssistantId] ?? [];
      try {
        setError(null);
        const serverMessages = await fetchSessionBubbles(
          config.apiBase,
          sessionId,
          selectedAssistantId,
        );
        const plan = planTranscriptMutate({
          mode: "delete_pair",
          clientMessages: clientMessages.map((message) => ({
            role: message.role,
            text: message.text ?? "",
          })),
          clientIndex: uiIndex,
          serverMessages,
        });
        if (plan.action === "missing") {
          setError("找不到这条消息，无法删除。");
          return;
        }
        if (plan.action === "local") {
          let end = uiIndex + 1;
          if (clientMessages[uiIndex]?.role === "user") {
            while (end < clientMessages.length && clientMessages[end]?.role === "assistant") {
              end += 1;
            }
          }
          applyMutatedMessages(
            selectedAssistantId,
            clientMessages.filter((_, index) => index < uiIndex || index >= end),
          );
          return;
        }
        const { messages } = await mutateSessionMessages(config.apiBase, sessionId, {
          uiIndex: plan.uiIndex,
          mode: "delete_pair",
        });
        applyMutatedMessages(selectedAssistantId, messages);
        await refreshChatSessionListForAssistant(selectedAssistantId);
      } catch (cause) {
        setError(errorMessage(cause, "删除失败"));
      }
    },
    [
      applyMutatedMessages,
      config?.apiBase,
      loading,
      messagesByAssistant,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sessionByAssistant,
      setError,
    ],
  );

  const sendChatMessage = useCallback(
    async (
      rawText: string,
      opts2?: {
        fromQueue?: boolean;
        background?: { assistantId: string; sessionId: string };
        forkHop?: boolean;
        /** Replace the open transcript before appending this send (edit-resend). */
        seedMessages?: ChatMsg[];
      },
    ) => {
      const text = rawText.trim();
      if (!text || !config) {
        return;
      }
      const background = opts2?.background;
      const focusNow = currentFocus();
      if (background) {
        if (clientHasLiveTurn(liveTurnsRef.current.values(), background.sessionId)) {
          const focus = { assistantId: background.assistantId, sessionId: background.sessionId };
          const queued = [
            text,
            ...(queuesRef.current.get(sessionQueueKey(background.sessionId, background.assistantId)) ?? []),
          ];
          rememberQueue(focus, queued);
          return;
        }
      } else if (
        !opts2?.fromQueue &&
        focusedSessionHasLiveTurn(liveTurnsRef.current.values(), focusNow)
      ) {
        // Inbox followup: next turn after the live one. Do not POST /steer.
        const queued = [...(queuesRef.current.get(sessionQueueKey(focusNow.sessionId, focusNow.assistantId)) ?? []), text];
        rememberQueue(focusNow, queued);
        setInput("");
        const liveSessionId = focusNow.sessionId;
        if (liveSessionId && config.apiBase) {
          void apiSendJson(
            config.apiBase,
            `/api/sessions/${encodeURIComponent(liveSessionId)}/followup`,
            "POST",
            { text },
          ).catch(() => {
            /* local queue still drains after the live turn */
          });
        }
        return;
      }
      // 另起 / 重开这场对话并带上文：先 fork，再把剩下的交办送进新会话。
      // 不在这里做的话，原话会进当前回合，模型没有这条工具，只能说自己开不了新对话。
      // 回合还在跑时上面已经改排成 followup；steer 路径不收这句话（见聊天输入）。
      if (!opts2?.forkHop && forkContinueRef?.current) {
        const forkAsk = parseForkContinueRequest(text);
        const sourceSessionId = (background?.sessionId ?? focusNow.sessionId ?? "").trim();
        if (forkAsk && sourceSessionId) {
          if (!opts2?.fromQueue) {
            setInput("");
            writeComposeStash(contextMatterId, "");
          }
          const outcome = await forkContinueRef.current(sourceSessionId);
          if (!outcome.ok) {
            if (!opts2?.fromQueue) {
              setInput(text);
              writeComposeStash(contextMatterId, text);
            }
            return;
          }
          const assistantId = background?.assistantId ?? selectedAssistantIdRef.current;
          sessionByAssistantRef.current = {
            ...sessionByAssistantRef.current,
            [assistantId]: outcome.sessionId,
          };
          focusedSessionRef.current = outcome.sessionId;
          focusOverrideRef.current = { assistantId, sessionId: outcome.sessionId };
          const next =
            forkAsk.remainder || (forkAsk.continueWork ? FORK_CONTINUE_WORK_MESSAGE : "");
          if (next && !parseForkContinueRequest(next)) {
            await sendChatMessageRef.current(next, { forkHop: true });
          }
          return;
        }
      }
      const picked = modelCatalog.find((m) => m.id === selectedModelId);
      setComposeModelHint(null);
      if (health?.modelConfigured === false) {
        setComposeModelHint(MODEL_NOT_CONFIGURED_USER_HINT);
        setShowWizard(true);
        return;
      }
      if (
        picked &&
        blockSendForUnconfiguredCatalogRow({
          catalogRowConfigured: picked.configured,
          healthModelConfigured: health?.modelConfigured,
        })
      ) {
        setError(`「${picked.label}」还没填写密钥。请打开连接向导，或添加自定义模型。`);
        useSettingsPanelStore.getState().setSettingsPanel(true, "models");
        return;
      }
      if (
        health?.modelConfigured === true &&
        !isActiveModelVerified({
          catalog: modelCatalog,
          selectedModelId,
          healthVerified: health.modelVerified,
        })
      ) {
        setComposeModelHint(MODEL_NOT_VERIFIED_HINT);
        return;
      }
      const assistantId = background?.assistantId ?? selectedAssistantIdRef.current;
      const ac = new AbortController();
      let stoppedByUser = false;
      const turn: LiveTurn = {
        assistantId,
        boundSessionId: background?.sessionId ?? sessionByAssistantRef.current[assistantId],
        userText: text,
        abort: ac,
        uiDetached: Boolean(background),
        rebind: false,
      };
      const turnKey = `turn-${++turnSeqRef.current}`;
      const turnQueueKey = sessionQueueKey(turn.boundSessionId, assistantId);
      liveTurnsRef.current.set(turnKey, turn);
      publishRunning();
      const titledSessionId = turn.boundSessionId?.trim();
      if (titledSessionId) {
        setChatSessionList?.((prev) =>
          retitlePlaceholderChatSession(prev, titledSessionId, text, {
            assistantId,
            matterId: contextMatterId,
          }),
        );
      }
      const implicitWordPins = background
        ? []
        : resolveImplicitWordPinsForChat({
            text,
            existing: fileChatContextItems,
          });
      const sendFilePins: FileChatContextItem[] = background
        ? []
        : [
        ...fileChatContextItems,
        ...implicitWordPins.map((it) => ({
          id: makeFileContextItemId(it),
          ...it,
        })),
      ];
      let excerpts: Awaited<ReturnType<typeof fetchFileChatExcerpts>>;
      try {
        excerpts = await fetchFileChatExcerpts({
          apiBase: config.apiBase,
          items: sendFilePins,
          signal: ac.signal,
        });
      } catch (cause) {
        liveTurnsRef.current.delete(turnKey);
        publishRunning();
        setLoading(focusedSessionHasLiveTurn(liveTurnsRef.current.values(), currentFocus()));
        if (turnStillOwnsComposer(turn, currentFocus())) {
          setInput(text);
          if (!isFetchAbortError(cause)) {
            setError(errorMessage(cause, "发送失败"));
          }
        }
        return;
      }
      const prefix = buildFileContextMessagePrefix(sendFilePins, excerpts);
      let learnPrefix = "";
      if (shouldAttachContractRevisionIndex(sendFilePins, deskContractBatchDir || undefined, text)) {
        try {
          learnPrefix = await fetchContractRevisionIndexPrefix(config.apiBase, ac.signal);
        } catch (cause) {
          liveTurnsRef.current.delete(turnKey);
          publishRunning();
          setLoading(focusedSessionHasLiveTurn(liveTurnsRef.current.values(), currentFocus()));
          if (turnStillOwnsComposer(turn, currentFocus())) {
            setInput(text);
            if (!isFetchAbortError(cause)) {
              setError(errorMessage(cause, "发送失败"));
            }
          }
          return;
        }
      }
      let messageForApi = text;
      const headParts: string[] = [];
      if (prefix.trim()) {
        headParts.push(prefix.trimEnd());
      }
      if (learnPrefix.trim()) {
        headParts.push(learnPrefix.trimEnd());
      }
      if (headParts.length > 0) {
        messageForApi = `${headParts.join("\n\n")}\n\n${text}`;
      }
      setError(null);
      const ownsComposer = !background && turnStillOwnsComposer(turn, currentFocus());
      if (ownsComposer) {
        setInput("");
        writeComposeStash(contextMatterId, "");
      } else {
        turn.uiDetached = true;
      }
      let assistantPlaceholderIndex = -1;
      let completedSessionId: string | undefined = turn.boundSessionId;
      let drainKey = turnQueueKey;
      if (!turn.uiDetached) {
        setMessagesByAssistant((previous) => {
          const base =
            opts2?.seedMessages != null
              ? { ...previous, [assistantId]: opts2.seedMessages }
              : previous;
          const next = appendChatMessage(base, assistantId, { role: "user", text });
          const withPlaceholder = appendChatMessage(next, assistantId, {
            role: "assistant",
            text: "",
            activity: createEmptyActivity(),
            activityActive: true,
            liveTrace: createEmptyLiveTrace(),
          });
          assistantPlaceholderIndex = (withPlaceholder[assistantId]?.length ?? 1) - 1;
          return withPlaceholder;
        });
        setLoading(true);
      }
      const updatePlaceholder = (mutator: (msg: ChatMsg) => ChatMsg): void => {
        if (turn.uiDetached) {
          return;
        }
        setMessagesByAssistant((previous) => {
          const list = previous[assistantId] ?? [];
          let index = assistantPlaceholderIndex;
          if (
            turn.rebind ||
            index < 0 ||
            index >= list.length ||
            list[index]?.role !== "assistant"
          ) {
            index = -1;
            for (let i = list.length - 1; i >= 0; i -= 1) {
              if (list[i]?.role === "assistant") {
                index = i;
                break;
              }
            }
            if (index < 0) {
              return previous;
            }
            assistantPlaceholderIndex = index;
            turn.rebind = false;
          }
          const current = list[index];
          if (!current || current.role !== "assistant") {
            return previous;
          }
          const nextList = list.slice();
          nextList[index] = mutator(current);
          return { ...previous, [assistantId]: nextList };
        });
      };
      const toolNamesById = new Map<string, string>();
      try {
        const effectiveModelId = resolveComposeModelSelectValue(modelCatalog, selectedModelId);
        const contextPins = buildContextPinsPayload({
          filePins: sendFilePins.map((it) => ({
            root: it.root,
            relPath: it.relPath,
            kind: it.kind,
          })),
          truthPins: background ? [] : composeTruthPins,
        });
        const result = await sendChatTurnStream(
          {
            apiBase: config.apiBase,
            modelId: effectiveModelId,
            message: messageForApi,
            sessionTitleHint: text,
            sessionId: turn.boundSessionId,
            assistantId,
            allowWebSearch,
            matterId: background ? undefined : contextMatterId,
            projectDir: background ? undefined : projectDir,
            contextPins: contextPins.length > 0 ? contextPins : undefined,
            linkedTaskId: background ? undefined : contextTaskId,
            permissionMode: readComposePermissionMode(),
            signal: ac.signal,
          },
          {
            onRoundStart: (roundIndex) => {
              updatePlaceholder((msg) => ({
                ...msg,
                activityActive: true,
                liveTrace: applyRoundStart(msg.liveTrace ?? createEmptyLiveTrace(), roundIndex),
              }));
            },
            onDelta: (chunk) => {
              updatePlaceholder((msg) => {
                const activity = appendActivityDelta(msg.activity ?? createEmptyActivity(), chunk);
                return {
                  ...msg,
                  activityActive: true,
                  activity,
                  text: (msg.text ?? "") + chunk,
                };
              });
            },
            onToolCallStart: (info) => {
              toolNamesById.set(info.toolCallId, info.toolName);
              updatePlaceholder((msg) => ({
                ...msg,
                activityActive: true,
                activity: startActivityTool(msg.activity ?? createEmptyActivity(), info),
                liveTrace: applyToolStart(msg.liveTrace ?? createEmptyLiveTrace(), info),
              }));
            },
            onToolProgress: (info) => {
              if (!info.label.trim()) {return;}
              updatePlaceholder((msg) => ({
                ...msg,
                activityActive: true,
                activity: appendActivityToolProgress(msg.activity ?? createEmptyActivity(), info),
                liveTrace: applyToolProgress(msg.liveTrace ?? createEmptyLiveTrace(), info.label),
              }));
            },
            onToolCallEnd: (info) => {
              const name = info.toolName || toolNamesById.get(info.toolCallId) || "tool";
              const gapNotice = noticeFromToolAuthorityGap(name, info.authorityGap === true);
              const demoNotice = noticeFromToolDemoCorpus(info.demoCorpus === true);
              updatePlaceholder((msg) => ({
                ...msg,
                activityActive: true,
                activity: endActivityTool(msg.activity ?? createEmptyActivity(), {
                  ...info,
                  toolName: name,
                }),
                liveTrace: applyToolEnd(msg.liveTrace ?? createEmptyLiveTrace(), {
                  ...info,
                  toolName: name,
                }),
                ...(gapNotice ? { authorityGapNotice: gapNotice } : {}),
                ...(demoNotice ? { demoCorpusNotice: demoNotice } : {}),
                ...(info.nextActions?.length
                  ? {
                      researchNextActions: [
                        ...new Set([...(msg.researchNextActions ?? []), ...info.nextActions]),
                      ],
                    }
                  : {}),
              }));
            },
            onTokenBudget: (info) => {
              if (!turn.uiDetached) {
                applyStreamTokenBudget?.(info);
              }
            },
            onToolBudget: (info) => {
              if (!turn.uiDetached) {
                onStreamToolBudget?.(info);
              }
            },
            onCompactBoundary: (info) => {
              if (!turn.uiDetached) {
                onStreamCompactBoundary?.(info);
              }
            },
            onVerifyGap: (info) => {
              updatePlaceholder((msg) => ({
                ...msg,
                activityActive: true,
                liveTrace: applyVerifyGap(msg.liveTrace ?? createEmptyLiveTrace(), info.message),
              }));
            },
            onContextDeferralBounce: (info) => {
              // 已经流出去的推诿原文立刻清掉：onDelta 是追加式，清空后下一轮的真实
              // 答复会从干净气泡开始，律师不会读到「请另开一轮」。
              updatePlaceholder((msg) => (msg.text ? { ...msg, text: "" } : msg));
              if (!turn.uiDetached) {
                onStreamContextDeferralBounce?.(info);
              }
            },
            onPlanUpdate: (plan) => {
              updatePlaceholder((msg) => ({
                ...msg,
                turnPlan: plan,
              }));
            },
          },
        );
        if (ac.signal.aborted) {
          return;
        }
        if (result.sessionId) {
          completedSessionId = result.sessionId;
          const nextKey = sessionQueueKey(result.sessionId, assistantId);
          if (nextKey !== turnQueueKey) {
            const pending = queuesRef.current.get(turnQueueKey) ?? [];
            const existing = queuesRef.current.get(nextKey) ?? [];
            queuesRef.current.set(nextKey, [...existing, ...pending]);
            queuesRef.current.delete(turnQueueKey);
            drainKey = nextKey;
          }
          if (!turn.uiDetached) {
            focusedSessionRef.current = result.sessionId;
            if (focusOverrideRef.current?.assistantId === assistantId) {
              focusOverrideRef.current = { assistantId, sessionId: result.sessionId };
            }
            setSessionByAssistant((previous) => ({ ...previous, [assistantId]: result.sessionId }));
            persistActiveChatSessionId(
              chatSessionStoreKey(config.workspaceDir),
              assistantId,
              result.sessionId,
            );
            syncVisibleQueue({ assistantId, sessionId: result.sessionId });
          }
        }
        if (turn.uiDetached) {
          if (
            result.sessionId &&
            focusedSessionRef.current === result.sessionId &&
            selectedAssistantIdRef.current === assistantId
          ) {
            await loadSessionMessagesIntoState?.(assistantId, result.sessionId);
          }
        } else {
        setMessagesByAssistant((previous) => {
          const list = previous[assistantId] ?? [];
          let index = assistantPlaceholderIndex;
          if (
            turn.rebind ||
            index < 0 ||
            index >= list.length ||
            list[index]?.role !== "assistant"
          ) {
            index = -1;
            for (let i = list.length - 1; i >= 0; i -= 1) {
              if (list[i]?.role === "assistant") {
                index = i;
                break;
              }
            }
          }
          if (index < 0) {
            return appendChatMessage(previous, assistantId, result.assistantMessage);
          }
          const nextList = list.slice();
          const prev = list[index];
          const finalText = result.assistantMessage.text?.trim() ?? "";
          const placeholderText = prev?.role === "assistant" ? (prev.text ?? "").trim() : "";
          const useFinal =
            finalText.length > 0 && finalText !== "(empty)";
          const activityDone = finalizeActivity(prev?.activity ?? createEmptyActivity());
          const activityText = textFromActivity(activityDone);
          nextList[index] = {
            ...result.assistantMessage,
            text:
              useFinal
                ? finalText
                : activityText || placeholderText || finalText || "本轮未返回可见回复，请查看中间栏或重试。",
            activity: activityDone,
            activityActive: false,
            liveTrace: finalizeLiveTrace(prev?.liveTrace ?? createEmptyLiveTrace()),
            turnPlan: result.assistantMessage.turnPlan ?? prev?.turnPlan,
          };
          return { ...previous, [assistantId]: nextList };
        });
        }
        await refreshChatSessionListForAssistant(assistantId);
        await refreshLists();
        await refreshAssistants();
        await refreshCollaboration();
      } catch (cause) {
        const removePlaceholder = (msgs: Record<string, ChatMsg[]>): Record<string, ChatMsg[]> => {
          if (assistantPlaceholderIndex < 0) {return msgs;}
          const list = msgs[assistantId] ?? [];
          if (assistantPlaceholderIndex >= list.length) {return msgs;}
          const target = list[assistantPlaceholderIndex];
          if (target.role !== "assistant") {return msgs;}
          const nextList = list.slice();
          nextList.splice(assistantPlaceholderIndex, 1);
          return { ...msgs, [assistantId]: nextList };
        };
        if (isFetchAbortError(cause)) {
          stoppedByUser = true;
          if (!turn.uiDetached) {
            setMessagesByAssistant((previous) => removePlaceholder(previous));
            setMessagesByAssistant((previous) =>
              dropTrailingUserMessageIfText(previous, assistantId, turn.userText),
            );
            setInput(turn.userText);
          } else if (
            completedSessionId &&
            focusedSessionRef.current === completedSessionId &&
            selectedAssistantIdRef.current === assistantId
          ) {
            await loadSessionMessagesIntoState?.(assistantId, completedSessionId);
          }
          setError(null);
          return;
        }
        const modelFailure = isModelFailureError(cause);
        const message = errorMessage(cause, "发送失败");
        if (turn.uiDetached) {
          if (
            completedSessionId &&
            focusedSessionRef.current === completedSessionId &&
            selectedAssistantIdRef.current === assistantId
          ) {
            await loadSessionMessagesIntoState?.(assistantId, completedSessionId);
          }
          return;
        }
        setError(message);
        setMessagesByAssistant((previous) => {
          const list = previous[assistantId] ?? [];
          if (
            assistantPlaceholderIndex >= 0 &&
            assistantPlaceholderIndex < list.length &&
            list[assistantPlaceholderIndex]?.role === "assistant"
          ) {
            const nextList = list.slice();
            nextList[assistantPlaceholderIndex] = {
              role: "assistant",
              text: message,
              activityActive: false,
              ...(modelFailure
                ? { failureKind: "model" as const }
                : {
                    activity:
                      list[assistantPlaceholderIndex].activity &&
                      list[assistantPlaceholderIndex].activity!.length > 0
                        ? finalizeActivityFailed(list[assistantPlaceholderIndex].activity!)
                        : undefined,
                    liveTrace:
                      list[assistantPlaceholderIndex].liveTrace &&
                      (list[assistantPlaceholderIndex].liveTrace!.steps.length > 0 ||
                        list[assistantPlaceholderIndex].liveTrace!.active)
                        ? finalizeLiveTraceFailed(list[assistantPlaceholderIndex].liveTrace!)
                        : undefined,
                  }),
            };
            return { ...previous, [assistantId]: nextList };
          }
          return appendChatMessage(previous, assistantId, {
            role: "assistant",
            text: message,
            ...(modelFailure ? { failureKind: "model" as const } : {}),
          });
        });
      } finally {
        liveTurnsRef.current.delete(turnKey);
        publishRunning();
        setLoading(focusedSessionHasLiveTurn(liveTurnsRef.current.values(), currentFocus()));
        onTurnComplete?.({ toolNames: [...new Set(toolNamesById.values())] });
        const homeSession = completedSessionId ?? turn.boundSessionId;
        const queueVisible = () =>
          sessionQueueKey(focusedSessionRef.current, selectedAssistantIdRef.current) === drainKey;
        const writeQueue = (next: string[]) => {
          queuesRef.current.set(drainKey, next);
          if (queueVisible()) {
            sendQueueRef.current = next;
            setQueuedMessages(next);
          }
        };
        const dispatchQueued = (nextText: string, sessionId: string | undefined) => {
          const target = sessionId ?? turn.boundSessionId;
          const owns =
            Boolean(target) &&
            !turn.uiDetached &&
            turnStillOwnsComposer({ assistantId, boundSessionId: target }, currentFocus());
          if (owns && target) {
            sessionByAssistantRef.current = {
              ...sessionByAssistantRef.current,
              [assistantId]: target,
            };
          }
          queueMicrotask(() =>
            void sendChatMessage(
              nextText,
              owns || !target
                ? { fromQueue: true }
                : { fromQueue: true, background: { assistantId, sessionId: target } },
            ),
          );
        };
        // 用户主动「停止」＝停掉整轮：清空发送队列，不再自动续发下一条。
        if (stoppedByUser) {
          writeQueue([]);
          const sid = homeSession;
          if (sid && config?.apiBase) {
            void apiSendJson(
              config.apiBase,
              `/api/sessions/${encodeURIComponent(sid)}/followup/claim`,
              "POST",
              {},
            ).catch(() => {
              /* discard persisted follow-ups after stop */
            });
          }
        } else {
          const queued = queuesRef.current.get(drainKey) ?? [];
          const localNext = queued[0];
          writeQueue(queued.slice(1));
          const sid = homeSession;
          if (localNext?.trim()) {
            // Local queue is source of truth for this drain; clear sidecar so claim cannot double-send.
            if (sid && config?.apiBase) {
              void apiSendJson(
                config.apiBase,
                `/api/sessions/${encodeURIComponent(sid)}/followup/claim`,
                "POST",
                {},
              ).catch(() => {
                /* ignore */
              });
            }
            dispatchQueued(localNext, sid);
          } else if (sid && config?.apiBase) {
            void apiSendJson<{ notes?: string[] }>(
              config.apiBase,
              `/api/sessions/${encodeURIComponent(sid)}/followup/claim`,
              "POST",
              {},
            )
              .then((body) => {
                const notes = Array.isArray(body?.notes) ? body.notes : [];
                const first = notes.find((n) => typeof n === "string" && n.trim());
                if (first?.trim()) {
                  const extra = notes
                    .slice(1)
                    .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
                    .map((note) => note.trim());
                  writeQueue([...(queuesRef.current.get(drainKey) ?? []), ...extra]);
                  dispatchQueued(first.trim(), sid);
                }
              })
              .catch(() => {
                /* ignore claim failures */
              });
          }
        }
      }
    },
    [
      allowWebSearch,
      config,
      health?.modelConfigured,
      modelCatalog,
      selectedModelId,
      contextMatterId,
      contextTaskId,
      fileChatContextItems,
      composeTruthPins,
      deskContractBatchDir,
      loading,
      projectDir,
      refreshAssistants,
      refreshChatSessionListForAssistant,
      setChatSessionList,
      refreshCollaboration,
      refreshLists,
      selectedAssistantId,
      sessionByAssistant,
      applyStreamTokenBudget,
      onStreamCompactBoundary,
      onStreamContextDeferralBounce,
      onStreamToolBudget,
      onTurnComplete,
      currentFocus,
      loadSessionMessagesIntoState,
      publishRunning,
      rememberQueue,
      syncVisibleQueue,
      forkContinueRef,
    ],
  );

  sendChatMessageRef.current = sendChatMessage;

  const send = useCallback(async () => {
    await sendChatMessage(composeInput);
  }, [composeInput, sendChatMessage]);

  const editChatMessageAt = useCallback(
    async (uiIndex: number, nextText: string) => {
      const text = nextText.trim();
      if (!text || !config?.apiBase || loading) {
        return;
      }
      const sessionId = sessionByAssistant[selectedAssistantId];
      if (!sessionId) {
        return;
      }
      const clientMessages = messagesByAssistant[selectedAssistantId] ?? [];
      try {
        setError(null);
        // Screen index drifts after a failed call (local error bubble) or compact.
        // Align to the saved utterance, then truncate and send again.
        const serverMessages = await fetchSessionBubbles(
          config.apiBase,
          sessionId,
          selectedAssistantId,
        );
        const plan = planTranscriptMutate({
          mode: "truncate",
          clientMessages: clientMessages.map((message) => ({
            role: message.role,
            text: message.text ?? "",
          })),
          clientIndex: uiIndex,
          serverMessages,
        });
        if (plan.action === "missing") {
          setError("找不到这条消息，无法从这里重发。");
          return;
        }
        let seed: ChatMsg[];
        if (plan.action === "mutate") {
          const mutated = await mutateSessionMessages(config.apiBase, sessionId, {
            uiIndex: plan.uiIndex,
            mode: "truncate",
          });
          seed = mutated.messages;
        } else {
          seed = clientMessages.slice(0, uiIndex);
        }
        applyMutatedMessages(selectedAssistantId, seed);
        await sendChatMessage(text, { seedMessages: seed });
        try {
          await refreshChatSessionListForAssistant(selectedAssistantId);
        } catch {
          /* list refresh must not hide a resend that already started */
        }
      } catch (cause) {
        setError(errorMessage(cause, "修改失败"));
      }
    },
    [
      applyMutatedMessages,
      config?.apiBase,
      loading,
      messagesByAssistant,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sendChatMessage,
      sessionByAssistant,
      setError,
    ],
  );

  const cancelQueuedMessage = useCallback((index: number) => {
    const focus = currentFocus();
    const next = (queuesRef.current.get(sessionQueueKey(focus.sessionId, focus.assistantId)) ?? []).filter(
      (_, i) => i !== index,
    );
    rememberQueue(focus, next);
  }, [currentFocus, rememberQueue]);

  const clearSendQueue = useCallback(() => {
    rememberQueue(currentFocus(), []);
  }, [currentFocus, rememberQueue]);

  return {
    abortChatSend,
    sendChatMessage,
    send,
    deleteChatMessageAt,
    editChatMessageAt,
    queuedMessages,
    cancelQueuedMessage,
    clearSendQueue,
  };
}
