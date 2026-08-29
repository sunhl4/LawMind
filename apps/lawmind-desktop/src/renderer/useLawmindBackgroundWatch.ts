import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { errorMessage } from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth";
import type { ChatMsg } from "./lawmind-chat";
import type { LawmindMainView } from "./lawmind-main-view";
import {
  activityBlocksEqual,
  activityFromLiveTrace,
  createEmptyActivity,
  type ChatActivityBlock,
} from "./lawmind-chat-activity.js";
import {
  createEmptyLiveTrace,
  fetchChatLiveTurnProgress,
  finalizeLiveTrace,
  finalizeLiveTraceFailed,
  liveTraceFromServerProgress,
  liveTracesEqual,
  type ChatLiveTrace,
} from "./lawmind-chat-trace.js";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { ChatSessionListEntry } from "./useLawmindChatShell";
import {
  chatSessionStoreKey,
  DEFAULT_CHAT_SESSION_TITLE,
  persistActiveChatSessionId,
} from "./useLawmindChatShell";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";

export type BackgroundWatchOpts = {
  sessionId: string;
  assistantId: string;
  taskId?: string;
  kind?: "revision" | "delegation" | "generic";
  hints?: { complete?: string; failed?: string; timeout?: string };
  resumeOnly?: boolean;
};

export type UseLawmindBackgroundWatchInput = {
  config: AppConfig | null;
  sessionByAssistant: Record<string, string | undefined>;
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  setChatSessionList: Dispatch<SetStateAction<ChatSessionListEntry[]>>;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  loadSessionMessagesIntoState: (
    assistantId: string,
    sessionId: string,
    signal?: AbortSignal,
    overlay?: {
      liveTrace?: ChatLiveTrace;
      activity?: ChatActivityBlock[];
      activityActive?: boolean;
      executionState?: ChatMsg["executionState"];
    },
  ) => Promise<void>;
  setMainView: (v: LawmindMainView) => void;
  setSelectedAssistantId: (id: string) => void;
  setContextTaskId: (id: string | null) => void;
  setRevisionBackgroundActive: (v: boolean) => void;
  setReviewFocusTaskId: (id: string | null) => void;
  setReviewFocusStatus: (s: ArtifactDraft["reviewStatus"] | "all") => void;
  setReviewFocusListMode: (m: "pending" | "all") => void;
  setReviewRefreshVersion: Dispatch<SetStateAction<number>>;
  setMatterRefreshVersion: Dispatch<SetStateAction<number>>;
  setError: (msg: string | null) => void;
  flashComposeModelHint: (msg: string, ms?: number) => void;
  refreshLists: () => Promise<void>;
};

export function useLawmindBackgroundWatch(input: UseLawmindBackgroundWatchInput) {
  const {
    config,
    sessionByAssistant,
    setMessagesByAssistant,
    setChatSessionList,
    setSessionByAssistant,
    loadSessionMessagesIntoState,
    setMainView,
    setSelectedAssistantId,
    setContextTaskId,
    setRevisionBackgroundActive,
    setReviewFocusTaskId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setReviewRefreshVersion,
    setMatterRefreshVersion,
    setError,
    flashComposeModelHint,
    refreshLists,
  } = input;

  const backgroundSessionWatchRef = useRef<{
    intervalId: ReturnType<typeof setInterval> | null;
    sessionId: string;
    assistantId: string;
  } | null>(null);
  const sessionByAssistantRef = useRef<Record<string, string | undefined>>({});
  sessionByAssistantRef.current = sessionByAssistant;

  const stopBackgroundSessionWatch = useCallback(() => {
    const watch = backgroundSessionWatchRef.current;
    if (watch?.intervalId) {
      clearInterval(watch.intervalId);
    }
    backgroundSessionWatchRef.current = null;
  }, []);

  useEffect(() => () => stopBackgroundSessionWatch(), [stopBackgroundSessionWatch]);

  const watchBackgroundSessionProgress = useCallback(
    async (opts: {
      sessionId: string;
      assistantId: string;
      taskId?: string;
      kind?: "revision" | "delegation" | "generic";
      hints?: { complete?: string; failed?: string; timeout?: string };
      /** 切换会话时恢复轮询，不跳转视图、不重复拉取整段历史 */
      resumeOnly?: boolean;
    }) => {
      if (!config?.apiBase || !config.workspaceDir || config.workspaceDir.trim().startsWith("(")) {
        return;
      }
      const sessionId = opts.sessionId.trim();
      const assistantId = opts.assistantId.trim();
      if (!sessionId || !assistantId) {
        return;
      }
      const hints = opts.hints;
      const watchKind = opts.kind ?? "generic";
      const resumeOnly = opts.resumeOnly === true;
      const existingWatch = backgroundSessionWatchRef.current;
      if (
        resumeOnly &&
        existingWatch?.sessionId === sessionId &&
        existingWatch?.assistantId === assistantId
      ) {
        return;
      }
      if (watchKind === "revision") {
        setRevisionBackgroundActive(true);
      }
      stopBackgroundSessionWatch();
      if (!resumeOnly) {
        setError(null);
        setMainView("workspace");
        if (opts.taskId?.trim()) {
          setContextTaskId(opts.taskId.trim());
        }
        setSelectedAssistantId(assistantId);
        persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, sessionId);
        setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
      }

      const BACKGROUND_WATCH_TIMEOUT_MS = 10 * 60 * 1000;
      const watchStartedAt = Date.now();
      let latestTrace: ChatLiveTrace | undefined;
      let watchFinished = false;
      let pollInFlight = false;

      const isWatchTargetActive = (): boolean =>
        sessionByAssistantRef.current[assistantId] === sessionId &&
        backgroundSessionWatchRef.current?.sessionId === sessionId;

      try {
        if (!resumeOnly) {
          const listRes = await fetch(
            `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
            { headers: { ...apiAuthHeaders() } },
          );
          const listJ = (await listRes.json()) as {
            ok?: boolean;
            sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
          };
          if (listJ.ok && Array.isArray(listJ.sessions)) {
            setChatSessionList(
              listJ.sessions.map((s) => ({
                sessionId: s.sessionId,
                title: typeof s.title === "string" && s.title.trim() ? s.title : DEFAULT_CHAT_SESSION_TITLE,
                updatedAt: s.updatedAt,
              })),
            );
          }

          const sessionRes = await fetch(
            `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
            { headers: { ...apiAuthHeaders() } },
          );
          const sessionJ = (await sessionRes.json()) as {
            ok?: boolean;
            messages?: Array<{
              role: string;
              text?: string;
              liveTrace?: ChatLiveTrace;
              executionState?: ChatMsg["executionState"];
            }>;
          };
          let msgs: ChatMsg[] = [];
          if (sessionJ.ok && Array.isArray(sessionJ.messages)) {
            msgs = sessionJ.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({
                role: m.role as "user" | "assistant",
                text: typeof m.text === "string" ? m.text : "",
                ...(m.liveTrace ? { liveTrace: m.liveTrace } : {}),
                ...(m.executionState ? { executionState: m.executionState } : {}),
              }));
          }
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && !last.text?.trim()) {
            msgs = [
              ...msgs.slice(0, -1),
              {
                ...last,
                liveTrace: last.liveTrace ?? createEmptyLiveTrace(),
                activity: last.activity ?? createEmptyActivity(),
                activityActive: true,
              },
            ];
          } else if (!last || last.role === "user") {
            msgs = [
              ...msgs,
              {
                role: "assistant",
                text: "",
                liveTrace: createEmptyLiveTrace(),
                activity: createEmptyActivity(),
                activityActive: true,
              },
            ];
          }
          setMessagesByAssistant((p) => ({ ...p, [assistantId]: msgs }));
        } else {
          const live = await fetchChatLiveTurnProgress(config.apiBase, sessionId);
          if (!live.progress || live.progress.status !== "running") {
            if (watchKind === "revision") {
              setRevisionBackgroundActive(false);
            }
            return;
          }
          const trace = liveTraceFromServerProgress(live.progress);
          latestTrace = trace;
          const activity = activityFromLiveTrace(trace);
          setMessagesByAssistant((prev) => {
            if (sessionByAssistantRef.current[assistantId] !== sessionId) {
              return prev;
            }
            const list = prev[assistantId] ?? [];
            if (list.length === 0) {
              return {
                ...prev,
                [assistantId]: [
                  {
                    role: "assistant",
                    text: "",
                    liveTrace: trace,
                    activity,
                    activityActive: true,
                  },
                ],
              };
            }
            const idx = list.length - 1;
            const row = list[idx];
            if (
              row.liveTrace?.active &&
              liveTracesEqual(row.liveTrace, trace) &&
              activityBlocksEqual(row.activity ?? [], activity)
            ) {
              return prev;
            }
            if (row.liveTrace?.active) {
              return prev;
            }
            const nextList = list.slice();
            if (row.role === "assistant") {
              nextList[idx] = { ...row, liveTrace: trace, activity, activityActive: true };
            } else {
              nextList.push({
                role: "assistant",
                text: "",
                liveTrace: trace,
                activity,
                activityActive: true,
              });
            }
            return { ...prev, [assistantId]: nextList };
          });
        }

        const applyLiveProgress = (
          progress: NonNullable<Awaited<ReturnType<typeof fetchChatLiveTurnProgress>>["progress"]>,
        ) => {
          if (!isWatchTargetActive()) {
            return;
          }
          const trace = liveTraceFromServerProgress(progress);
          latestTrace = trace;
          setMessagesByAssistant((prev) => {
            if (sessionByAssistantRef.current[assistantId] !== sessionId) {
              return prev;
            }
            const list = prev[assistantId] ?? [];
            if (list.length === 0) {
              return prev;
            }
            const idx = list.length - 1;
            const row = list[idx];
            if (row.role !== "assistant") {
              return prev;
            }
            const activity = activityFromLiveTrace(trace);
            if (
              liveTracesEqual(row.liveTrace, trace) &&
              activityBlocksEqual(row.activity ?? [], activity)
            ) {
              return prev;
            }
            const nextList = list.slice();
            nextList[idx] = {
              ...row,
              liveTrace: trace,
              activity,
              activityActive: trace.active,
            };
            return { ...prev, [assistantId]: nextList };
          });
        };

        const finishWatch = async (failed: boolean, hintOverride?: string) => {
          if (watchFinished) {
            return;
          }
          watchFinished = true;
          stopBackgroundSessionWatch();
          if (watchKind === "revision") {
            setRevisionBackgroundActive(false);
          }
          const traceSnapshot = latestTrace
            ? failed
              ? finalizeLiveTraceFailed(latestTrace)
              : finalizeLiveTrace(latestTrace)
            : undefined;
          const activitySnapshot = traceSnapshot
            ? activityFromLiveTrace({ ...traceSnapshot, active: false })
            : undefined;
          await loadSessionMessagesIntoState(assistantId, sessionId, undefined, {
            liveTrace: traceSnapshot,
            activity: activitySnapshot,
            activityActive: false,
          });
          if (watchKind === "revision" && !failed && opts.taskId?.trim()) {
            const taskId = opts.taskId.trim();
            setReviewFocusTaskId(taskId);
            setReviewFocusStatus("pending");
            setReviewFocusListMode("pending");
            setReviewRefreshVersion((v) => v + 1);
            setMatterRefreshVersion((v) => v + 1);
          }
          try {
            const listRes2 = await fetch(
              `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
              { headers: { ...apiAuthHeaders() } },
            );
            const listJ2 = (await listRes2.json()) as {
              ok?: boolean;
              sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
            };
            if (listJ2.ok && Array.isArray(listJ2.sessions)) {
              setChatSessionList(
                listJ2.sessions.map((s) => ({
                  sessionId: s.sessionId,
                  title: typeof s.title === "string" && s.title.trim() ? s.title : DEFAULT_CHAT_SESSION_TITLE,
                  updatedAt: s.updatedAt,
                })),
              );
            }
          } catch {
            /* ignore */
          }
          await refreshLists();
          if (!resumeOnly) {
            flashComposeModelHint(
              hintOverride ??
                (failed
                  ? hints?.failed ?? "后台任务未完成，请查看对话中的错误信息"
                  : watchKind === "revision" && !failed
                    ? hints?.complete ?? "修订已完成，已恢复为待审核，请查看新正文"
                    : hints?.complete ?? "后台任务已完成"),
              7000,
            );
          } else if (watchKind === "revision" && !failed) {
            flashComposeModelHint(
              hintOverride ?? hints?.complete ?? "修订已完成，已恢复为待审核，请查看新正文",
              7000,
            );
          }
        };

        const poll = async () => {
          if (watchFinished || pollInFlight) {
            return;
          }
          if (!isWatchTargetActive()) {
            stopBackgroundSessionWatch();
            return;
          }
          if (Date.now() - watchStartedAt > BACKGROUND_WATCH_TIMEOUT_MS) {
            await finishWatch(
              true,
              hints?.timeout ?? "后台任务轮询超时，请手动刷新会话查看结果",
            );
            return;
          }
          pollInFlight = true;
          try {
            const live = await fetchChatLiveTurnProgress(config.apiBase, sessionId);
            if (!isWatchTargetActive()) {
              stopBackgroundSessionWatch();
              return;
            }
            if (live.progress) {
              applyLiveProgress(live.progress);
              if (live.progress.status === "completed") {
                await finishWatch(false);
              } else if (live.progress.status === "failed") {
                await finishWatch(true);
              }
              return;
            }
            if (live.idle) {
              const sessionRes2 = await fetch(
                `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
                { headers: { ...apiAuthHeaders() } },
              );
              const sessionJ2 = (await sessionRes2.json()) as {
                ok?: boolean;
                messages?: Array<{ role: string; text?: string }>;
              };
              const messages = sessionJ2.ok && Array.isArray(sessionJ2.messages) ? sessionJ2.messages : [];
              const lastMsg = messages[messages.length - 1];
              const hasLatestAssistantReply =
                lastMsg?.role === "assistant" &&
                typeof lastMsg.text === "string" &&
                lastMsg.text.trim().length > 0;
              if (hasLatestAssistantReply) {
                await finishWatch(false);
              }
            }
          } catch {
            /* ignore transient poll errors */
          } finally {
            pollInFlight = false;
          }
        };

        backgroundSessionWatchRef.current = { intervalId: null, sessionId, assistantId };
        await poll();
        if (!watchFinished) {
          backgroundSessionWatchRef.current = {
            intervalId: setInterval(() => {
              void poll();
            }, 1500),
            sessionId,
            assistantId,
          };
        }
      } catch (cause) {
        setError(errorMessage(cause, "打开后台会话失败"));
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      flashComposeModelHint,
      loadSessionMessagesIntoState,
      refreshLists,
      stopBackgroundSessionWatch,
      setMainView,
      setReviewFocusTaskId,
      setReviewFocusStatus,
      setReviewFocusListMode,
      setReviewRefreshVersion,
      setMatterRefreshVersion,
    ],
  );

  const watchBackgroundRevisionSession = useCallback(
    async (opts: { sessionId: string; assistantId: string; taskId?: string }) => {
      await watchBackgroundSessionProgress({
        ...opts,
        kind: "revision",
        hints: {
          complete: "修订完成，可打开改稿核对",
          failed: "后台修订未完成，请查看对话中的错误信息",
          timeout: "后台修订轮询超时，请手动刷新会话查看结果",
        },
      });
    },
    [watchBackgroundSessionProgress],
  );

  return {
    backgroundSessionWatchRef,
    sessionByAssistantRef,
    stopBackgroundSessionWatch,
    watchBackgroundSessionProgress,
    watchBackgroundRevisionSession,
  };
}
