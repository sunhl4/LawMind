import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { isSelectedModelVerified, MODEL_NOT_VERIFIED_HINT } from "./lawmind-model-verify";
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
import {
  chatLooksLikeWordEdit,
  resolveImplicitWordPinsForChat,
} from "./lawmind-active-word-file";
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
  applyToolProgress,
  applyToolStart,
  createEmptyLiveTrace,
  finalizeLiveTrace,
  finalizeLiveTraceFailed,
} from "./lawmind-chat-trace.js";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { chatSessionStoreKey, persistActiveChatSessionId } from "./useLawmindChatShell";
import { readComposePermissionMode, writeComposeStash } from "./lawmind-compose-prefs";
import { abortSessionTurn, mutateSessionMessages } from "./lawmind-chat-message-mutate";
import { detectMailChatIntent } from "../../../../src/lawmind/platform/mail-chat-intent.ts";
import { promptMailIntentConfirm } from "./lawmind-mail-intent-bus";
import { requestOpenAutomationsSettings } from "./lawmind-automations-nav-bus";
import { runMailAutomationNow } from "./lawmind-mail-automation-run";

export type UseLawmindChatSendInput = {
  config: AppConfig | null;
  health: LawmindHealthState;
  input: string;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setShowWizard: Dispatch<SetStateAction<boolean>>;
  setShowSettings: import("./lawmind-settings-shell").SetShowSettings;
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
  }) => void;
  onStreamToolBudget?: (info: { used: number; maxToolCalls: number }) => void;
  /** After a turn finishes (success or failure) — e.g. refresh action-summary / sticky review. */
  onTurnComplete?: () => void;
};

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
    setShowSettings,
    setComposeModelHint,
    selectedAssistantId,
    selectedModelId,
    modelCatalog,
    sessionByAssistant,
    setSessionByAssistant,
    setMessagesByAssistant,
    contextMatterId,
    contextTaskId,
    fileChatContextItems,
    composeTruthPins,
    deskContractBatchDir,
    projectDir,
    allowWebSearch,
    refreshChatSessionListForAssistant,
    refreshLists,
    refreshAssistants,
    refreshCollaboration,
    applyStreamTokenBudget,
    onStreamCompactBoundary,
    onStreamToolBudget,
    onTurnComplete,
  } = opts;

  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const chatInFlightRef = useRef<{ assistantId: string; userText: string } | null>(null);
  const sendQueueRef = useRef<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const abortChatSend = useCallback(() => {
    const sessionId = sessionByAssistant[selectedAssistantId];
    if (config?.apiBase && sessionId) {
      void abortSessionTurn(config.apiBase, sessionId);
    }
    const taskId = contextTaskId?.trim();
    if (config?.apiBase && taskId) {
      void apiSendJson(config.apiBase, `/api/jobs/${encodeURIComponent(taskId)}/cancel`, "POST", {}).catch(
        () => undefined,
      );
    }
    chatAbortControllerRef.current?.abort();
  }, [config?.apiBase, contextTaskId, selectedAssistantId, sessionByAssistant]);

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
      try {
        setError(null);
        const { messages } = await mutateSessionMessages(config.apiBase, sessionId, {
          uiIndex,
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
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sessionByAssistant,
      setError,
    ],
  );

  const sendChatMessage = useCallback(
    async (rawText: string, opts2?: { fromQueue?: boolean }) => {
      const text = rawText.trim();
      if (!text || !config) {
        return;
      }
      if ((loading || chatInFlightRef.current) && !opts2?.fromQueue) {
        // Inbox followup: next turn after the live one. Do not POST /steer.
        sendQueueRef.current.push(text);
        setQueuedMessages([...sendQueueRef.current]);
        setInput("");
        return;
      }
      const picked = modelCatalog.find((m) => m.id === selectedModelId);
      setComposeModelHint(null);
      if (health?.modelConfigured === false) {
        setComposeModelHint(MODEL_NOT_CONFIGURED_USER_HINT);
        setShowWizard(true);
        return;
      }
      if (picked && !picked.configured) {
        setError(`「${picked.label}」尚未配置 API Key。请打开 API 配置向导或添加自定义模型。`);
        setShowSettings(true, "models");
        return;
      }
      if (health?.modelConfigured === true && !isSelectedModelVerified(modelCatalog, selectedModelId)) {
        setComposeModelHint(MODEL_NOT_VERIFIED_HINT);
        return;
      }
      // Mail / meta intent: offer automations short path before free-chat thrash.
      if (!opts2?.fromQueue) {
        const mailIntent = detectMailChatIntent(text);
        if (mailIntent) {
          setInput("");
          writeComposeStash(contextMatterId, "");
          const decision = await promptMailIntentConfirm(mailIntent);
          if (decision === "dismiss" || decision === "open-settings") {
            if (decision === "open-settings") {
              requestOpenAutomationsSettings();
            }
            setInput(text);
            return;
          }
          if (decision === "run") {
            if (
              (mailIntent.kind === "mail-contract-review" ||
                mailIntent.kind === "mail-inbox-digest") &&
              mailIntent.presetId
            ) {
              try {
                if (!contextMatterId?.trim()) {
                  setError("请先选择案件，再跑邮件短路径。");
                  setInput(text);
                  return;
                }
                await runMailAutomationNow({
                  apiBase: config.apiBase,
                  matterId: contextMatterId.trim(),
                  presetId: mailIntent.presetId,
                });
                setComposeModelHint("已启动邮件短路径，结果将出现在「待我拍板」。");
                setError(null);
              } catch (cause) {
                setError(errorMessage(cause, "启动短路径失败"));
                setInput(text);
              }
              return;
            }
            requestOpenAutomationsSettings();
            return;
          }
          // decision === "continue" → fall through to normal chat
        }
      }
      const assistantId = selectedAssistantId;
      const ac = new AbortController();
      let stoppedByUser = false;
      chatAbortControllerRef.current = ac;
      chatInFlightRef.current = { assistantId, userText: text };
      const implicitWordPins = resolveImplicitWordPinsForChat({
        text,
        existing: fileChatContextItems,
      });
      const sendFilePins: FileChatContextItem[] = [
        ...fileChatContextItems,
        ...implicitWordPins.map((it) => ({
          id: makeFileContextItemId(it),
          ...it,
        })),
      ];
      const excerpts = await fetchFileChatExcerpts({
        apiBase: config.apiBase,
        items: sendFilePins,
        signal: ac.signal,
      });
      const prefix = buildFileContextMessagePrefix(sendFilePins, excerpts);
      let learnPrefix = "";
      if (shouldAttachContractRevisionIndex(sendFilePins, deskContractBatchDir || undefined, text)) {
        learnPrefix = await fetchContractRevisionIndexPrefix(config.apiBase, ac.signal);
      }
      let messageForApi = text;
      const headParts: string[] = [];
      if (
        chatLooksLikeWordEdit(text) &&
        sendFilePins.some((it) => it.kind === "file" && /\.docx?$/i.test(it.relPath))
      ) {
        headParts.push("【Word 改稿】");
      }
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
      setInput("");
      // 发送成功后清空该案件的草稿暂存，避免 compose 恢复效应把刚发出的文本回填。
      writeComposeStash(contextMatterId, "");
      let assistantPlaceholderIndex = -1;
      setMessagesByAssistant((previous) => {
        const next = appendChatMessage(previous, assistantId, { role: "user", text });
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
      const updatePlaceholder = (mutator: (msg: ChatMsg) => ChatMsg): void => {
        setMessagesByAssistant((previous) => {
          const list = previous[assistantId] ?? [];
          if (assistantPlaceholderIndex < 0 || assistantPlaceholderIndex >= list.length) {
            return previous;
          }
          const current = list[assistantPlaceholderIndex];
          if (current.role !== "assistant") {
            return previous;
          }
          const nextList = list.slice();
          nextList[assistantPlaceholderIndex] = mutator(current);
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
          truthPins: composeTruthPins,
        });
        const result = await sendChatTurnStream(
          {
            apiBase: config.apiBase,
            modelId: effectiveModelId,
            message: messageForApi,
            sessionTitleHint: text,
            sessionId: sessionByAssistant[assistantId],
            assistantId,
            allowWebSearch,
            matterId: contextMatterId,
            projectDir,
            contextPins: contextPins.length > 0 ? contextPins : undefined,
            linkedTaskId: contextTaskId,
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
              applyStreamTokenBudget?.(info);
            },
            onToolBudget: (info) => {
              onStreamToolBudget?.(info);
            },
            onCompactBoundary: (info) => {
              onStreamCompactBoundary?.(info);
            },
          },
        );
        if (ac.signal.aborted) {
          return;
        }
        if (result.sessionId) {
          setSessionByAssistant((previous) => ({ ...previous, [assistantId]: result.sessionId }));
          persistActiveChatSessionId(
            chatSessionStoreKey(config.workspaceDir),
            assistantId,
            result.sessionId,
          );
        }
        setMessagesByAssistant((previous) => {
          const list = previous[assistantId] ?? [];
          if (assistantPlaceholderIndex < 0 || assistantPlaceholderIndex >= list.length) {
            return appendChatMessage(previous, assistantId, result.assistantMessage);
          }
          const nextList = list.slice();
          const prev = list[assistantPlaceholderIndex];
          const finalText = result.assistantMessage.text?.trim() ?? "";
          const placeholderText = prev?.role === "assistant" ? (prev.text ?? "").trim() : "";
          const useFinal =
            finalText.length > 0 && finalText !== "(empty)";
          const activityDone = finalizeActivity(prev?.activity ?? createEmptyActivity());
          const activityText = textFromActivity(activityDone);
          nextList[assistantPlaceholderIndex] = {
            ...result.assistantMessage,
            text:
              useFinal
                ? finalText
                : activityText || placeholderText || finalText || "本轮未返回可见回复，请查看改稿页或重试。",
            activity: activityDone,
            activityActive: false,
            liveTrace: finalizeLiveTrace(prev?.liveTrace ?? createEmptyLiveTrace()),
          };
          return { ...previous, [assistantId]: nextList };
        });
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
          const inflight = chatInFlightRef.current;
          setMessagesByAssistant((previous) => removePlaceholder(previous));
          if (inflight && inflight.assistantId === assistantId) {
            setMessagesByAssistant((previous) =>
              dropTrailingUserMessageIfText(previous, assistantId, inflight.userText),
            );
            setInput(inflight.userText);
          }
          setError(null);
          return;
        }
        const modelFailure = isModelFailureError(cause);
        const message = errorMessage(cause, "发送失败");
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
        chatAbortControllerRef.current = null;
        chatInFlightRef.current = null;
        setLoading(false);
        onTurnComplete?.();
        // 用户主动「停止」＝停掉整轮：清空发送队列，不再自动续发下一条。
        if (stoppedByUser) {
          sendQueueRef.current = [];
          setQueuedMessages([]);
        } else {
          const nextQueued = sendQueueRef.current.shift();
          setQueuedMessages([...sendQueueRef.current]);
          if (nextQueued?.trim()) {
            queueMicrotask(() => void sendChatMessage(nextQueued, { fromQueue: true }));
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
      refreshCollaboration,
      refreshLists,
      selectedAssistantId,
      sessionByAssistant,
      applyStreamTokenBudget,
      onStreamCompactBoundary,
      onStreamToolBudget,
      onTurnComplete,
    ],
  );

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
      // F2: warn that truncate drops later turns including tool evidence.
      const ok = window.confirm(
        "编辑并重发将截断该条之后的对话（含工具调用与结果证据）。确定继续？",
      );
      if (!ok) {
        return;
      }
      try {
        setError(null);
        const { messages } = await mutateSessionMessages(config.apiBase, sessionId, {
          uiIndex,
          mode: "truncate",
        });
        applyMutatedMessages(selectedAssistantId, messages);
        await refreshChatSessionListForAssistant(selectedAssistantId);
        await sendChatMessage(text);
      } catch (cause) {
        setError(errorMessage(cause, "修改失败"));
      }
    },
    [
      applyMutatedMessages,
      config?.apiBase,
      loading,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sendChatMessage,
      sessionByAssistant,
      setError,
    ],
  );

  const cancelQueuedMessage = useCallback((index: number) => {
    sendQueueRef.current = sendQueueRef.current.filter((_, i) => i !== index);
    setQueuedMessages([...sendQueueRef.current]);
  }, []);

  const clearSendQueue = useCallback(() => {
    sendQueueRef.current = [];
    setQueuedMessages([]);
  }, []);

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
