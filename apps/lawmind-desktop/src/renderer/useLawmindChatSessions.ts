import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  errorMessage,
  userMessageFromApiError,
  type ApiErrorJson,
  fetchApi,
  readJsonFromResponse,
} from "./api-client";
import { fetchApiJson } from "./api-client-proxy";
import { fetchChatLiveTurnProgress } from "./lawmind-chat-trace.js";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { DelegationRow } from "./lawmind-app-data";
import { isActiveDelegation } from "./lawmind-delegation-status";
import type { ChatMsg } from "./lawmind-chat";
import type { ChatSessionListEntry, LawmindChatShellState } from "./useLawmindChatShell";
import type { LawmindMainView } from "./lawmind-main-view";
import {
  chatSessionStoreKey,
  getStoredActiveChatSessionId,
  getStoredScopeSessionId,
  persistActiveChatSessionId,
  persistChatListScope,
  persistScopeSessionId,
  readStoredChatListScope,
} from "./useLawmindChatShell";
import {
  lawyerChatListTitle,
  mapChatSessionListPayload,
  mergeChatSessionListRefresh,
  upsertChatSessionAtFront,
} from "./lawmind-chat-session-list";
import {
  chatScopeForMatterId,
  inferInitialChatScope,
  isSessionInChatScope,
  pickChatSessionForScope,
} from "./lawmind-chat-scope";
import { readSelectedModelId } from "./lawmind-selected-model-pref";
import { clearPlanHandoff, deleteSessionPlanHandoff } from "./lawmind-plan-handoff";
import { confirmDialog } from "./lawmind-confirm-dialog";
import type { BackgroundWatchOpts } from "./useLawmindBackgroundWatch";

function sessionCreateErrorMessage(
  status: number,
  body: { ok?: boolean; sessionId?: string; message?: string; error?: string; code?: string },
): string {
  return userMessageFromApiError(status, body as ApiErrorJson);
}

export type UseLawmindChatSessionsInput = {
  config: AppConfig | null;
  selectedAssistantId: string;
  sessionByAssistant: Record<string, string | undefined>;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  setChatSessionList: Dispatch<SetStateAction<ChatSessionListEntry[]>>;
  setChatSessionsLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  loadSessionMessagesIntoState: (
    assistantId: string,
    sessionId: string,
    signal?: AbortSignal,
    overlay?: Parameters<
      LawmindChatShellState["loadSessionMessagesIntoState"]
    >[3],
    onSessionMatter?: (matterId: string | null) => void,
  ) => Promise<boolean>;
  refreshChatSessionListForAssistant: (assistantId: string) => Promise<ChatSessionListEntry[] | null>;
  watchBackgroundSessionFnRef: MutableRefObject<(opts: BackgroundWatchOpts) => Promise<void>>;
  setMainView: (v: LawmindMainView) => void;
  setSelectedAssistantId: (id: string) => void;
  setContextMatterId: (id: string | null) => void;
  assistants: Array<{ assistantId: string; displayName: string }>;
  modelCatalog: Array<{ id: string; label: string }>;
  selectedModelId: string;
  flashComposeModelHint: (msg: string, ms?: number) => void;
  chatSessionList?: ChatSessionListEntry[];
  setMessagesByAssistant?: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  /** 案件目录加载完成后才用来判断「原案件已不在」。null 表示还没加载。 */
  knownChatMatterIdsRef?: MutableRefObject<ReadonlySet<string> | null>;
  /** 案件目录更新后递增，用来把已删除案件的对话收进未归案。 */
  knownChatMatterTick?: number;
  /** Detach a live turn's transcript when the lawyer opens another conversation. */
  noteFocusedChatSessionRef?: MutableRefObject<
    (focus: { assistantId: string; sessionId: string | undefined }) => void
  >;
  /** Stop a live turn before its conversation is deleted. */
  abortLiveChatSessionRef?: MutableRefObject<(sessionId: string) => void>;
  /** This window still has the live stream for the session. */
  hasLiveClientTurnRef?: MutableRefObject<(sessionId: string) => boolean>;
  /** Resume painting that stream after the transcript reload. */
  reattachLiveChatSessionRef?: MutableRefObject<(sessionId: string) => void>;
};

export function useLawmindChatSessions(input: UseLawmindChatSessionsInput) {
  const {
    config,
    selectedAssistantId,
    sessionByAssistant,
    setSessionByAssistant,
    setChatSessionList,
    setChatSessionsLoading,
    setError,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
    watchBackgroundSessionFnRef,
    setMainView,
    setSelectedAssistantId,
    setContextMatterId,
    assistants,
    modelCatalog,
    selectedModelId,
    flashComposeModelHint,
    chatSessionList = [],
    setMessagesByAssistant,
    knownChatMatterIdsRef: knownChatMatterIdsRefProp,
    knownChatMatterTick = 0,
    noteFocusedChatSessionRef,
    abortLiveChatSessionRef,
    hasLiveClientTurnRef,
    reattachLiveChatSessionRef,
  } = input;
  const fallbackKnownRef = useRef<ReadonlySet<string> | null>(null);
  const knownChatMatterIdsRef = knownChatMatterIdsRefProp ?? fallbackKnownRef;
  const [chatListScope, setChatListScope] = useState<string | null>(null);
  const chatListScopeRef = useRef<string | null>(null);
  const selectedAssistantIdRef = useRef(selectedAssistantId);
  selectedAssistantIdRef.current = selectedAssistantId;
  const chatSessionListRef = useRef(chatSessionList);
  chatSessionListRef.current = chatSessionList;

  const rememberOpenedSession = useCallback(
    (sessionId: string, matterId: string | null) => {
      const storeKey = chatSessionStoreKey(config?.workspaceDir);
      const scope = chatScopeForMatterId(matterId, knownChatMatterIdsRef.current);
      chatListScopeRef.current = scope;
      setChatListScope(scope);
      persistChatListScope(storeKey, scope);
      persistScopeSessionId(storeKey, scope, sessionId);
      setContextMatterId(scope === null && matterId ? null : matterId);
    },
    [config?.workspaceDir, knownChatMatterIdsRef, setContextMatterId],
  );

  const hydrateWorkspaceChatSessions = useCallback(
    async (signal: AbortSignal) => {
      const assistantId = selectedAssistantIdRef.current;
      if (!config?.apiBase) {
        setChatSessionList([]);
        return;
      }
      const sessionStoreKey = chatSessionStoreKey(config.workspaceDir);
      setChatSessionsLoading(true);
      try {
        const listJ = await fetchApiJson<{
          ok?: boolean;
          sessions?: Array<{
            sessionId?: string;
            title?: string;
            updatedAt?: string;
            lastPreview?: string;
            matterId?: string | null;
            assistantId?: string;
            forkedToSessionId?: string;
          }>;
        }>(`${config.apiBase}/api/sessions`, { signal }, { tag: "chat-sessions:list" });
        if (signal.aborted) {
          return;
        }
        const mapped = mapChatSessionListPayload(listJ.sessions) ?? [];
        setChatSessionList((prev) => mergeChatSessionListRefresh(prev, mapped));
        const known = knownChatMatterIdsRef.current;
        const storedAssistantSessionId = getStoredActiveChatSessionId(sessionStoreKey, assistantId);
        const storedScope = readStoredChatListScope(sessionStoreKey);
        const scope =
          storedScope === undefined
            ? inferInitialChatScope(mapped, storedAssistantSessionId, known)
            : storedScope;
        chatListScopeRef.current = scope;
        setChatListScope(scope);
        persistChatListScope(sessionStoreKey, scope);
        const pick = pickChatSessionForScope(mapped, scope, known, {
          storedSessionId: getStoredScopeSessionId(sessionStoreKey, scope) ?? storedAssistantSessionId,
        });
        if (signal.aborted) {
          return;
        }
        if (!pick) {
          noteFocusedChatSessionRef?.current({ assistantId, sessionId: undefined });
          setSessionByAssistant((prev) => ({ ...prev, [assistantId]: undefined }));
          setMessagesByAssistant?.((prev) => ({ ...prev, [assistantId]: [] }));
          setContextMatterId(scope);
          return;
        }
        const openAssistantId = pick.assistantId?.trim() || assistantId;
        noteFocusedChatSessionRef?.current({ assistantId: openAssistantId, sessionId: pick.sessionId });
        persistActiveChatSessionId(sessionStoreKey, openAssistantId, pick.sessionId);
        setSessionByAssistant((prev) => ({ ...prev, [openAssistantId]: pick.sessionId }));
        setContextMatterId(chatScopeForMatterId(pick.matterId, known));
        if (openAssistantId !== assistantId) {
          setSelectedAssistantId(openAssistantId);
        }
        await loadSessionMessagesIntoState(
          openAssistantId,
          pick.sessionId,
          signal,
          undefined,
          (boundMatterId) => {
            rememberOpenedSession(pick.sessionId, boundMatterId);
          },
        );
        if (!signal.aborted && config?.apiBase) {
          try {
            const live = await fetchChatLiveTurnProgress(config.apiBase, pick.sessionId, signal);
            if (live.progress?.status === "running") {
              await watchBackgroundSessionFnRef.current({
                sessionId: pick.sessionId,
                assistantId: openAssistantId,
                kind: "generic",
                resumeOnly: true,
              });
            }
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
        setError(errorMessage(e, "加载对话列表失败"));
      } finally {
        if (!signal.aborted) {
          setChatSessionsLoading(false);
        }
      }
    },
    [
      config,
      knownChatMatterIdsRef,
      loadSessionMessagesIntoState,
      rememberOpenedSession,
      setChatSessionList,
      setChatSessionsLoading,
      setContextMatterId,
      setError,
      setMessagesByAssistant,
      setSelectedAssistantId,
      setSessionByAssistant,
      watchBackgroundSessionFnRef,
    ],
  );

  const selectChatSession = useCallback(
    async (sessionId: string, assistantIdOverride?: string) => {
      if (!config?.apiBase) {
        return;
      }
      const hintedAssistantId = assistantIdOverride?.trim() || selectedAssistantId;
      if (
        sessionId === sessionByAssistant[hintedAssistantId] &&
        hintedAssistantId === selectedAssistantId
      ) {
        return;
      }
      const previousFocus = {
        assistantId: selectedAssistantId,
        sessionId: sessionByAssistant[selectedAssistantId],
      };
      noteFocusedChatSessionRef?.current({ assistantId: hintedAssistantId, sessionId });
      let assistantId = assistantIdOverride?.trim() || "";
      if (!assistantId) {
        try {
          const meta = await fetchApiJson<{
            ok?: boolean;
            assistantId?: string;
          }>(
            `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}`,
            {},
            { tag: "chat-sessions:resolve-assistant" },
          );
          if (meta.ok && typeof meta.assistantId === "string" && meta.assistantId.trim()) {
            assistantId = meta.assistantId.trim();
          }
        } catch {
          /* fall through to current assistant */
        }
      }
      if (!assistantId) {
        assistantId = selectedAssistantId;
      }
      const ok = await loadSessionMessagesIntoState(
        assistantId,
        sessionId,
        undefined,
        undefined,
        (boundMatterId) => {
          // 打开旧对话＝回到它绑的那一案。未绑案或案件已不在则清空芯片，
          // 避免下一句把这场对话写进残留的另一个案件。
          rememberOpenedSession(sessionId, boundMatterId);
        },
      );
      if (!ok) {
        noteFocusedChatSessionRef?.current(previousFocus);
        return;
      }
      if (assistantId !== hintedAssistantId) {
        noteFocusedChatSessionRef?.current({ assistantId, sessionId });
      }
      if (assistantId !== selectedAssistantId) {
        setSelectedAssistantId(assistantId);
      }
      persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, sessionId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
      if (hasLiveClientTurnRef?.current(sessionId)) {
        reattachLiveChatSessionRef?.current(sessionId);
      } else {
        try {
          const live = await fetchChatLiveTurnProgress(config.apiBase, sessionId);
          if (live.progress?.status === "running") {
            await watchBackgroundSessionFnRef.current({
              sessionId,
              assistantId,
              kind: "generic",
              resumeOnly: true,
            });
          }
        } catch {
          /* ignore */
        }
      }
    },
    [config, hasLiveClientTurnRef, loadSessionMessagesIntoState, noteFocusedChatSessionRef, reattachLiveChatSessionRef, rememberOpenedSession, selectedAssistantId, sessionByAssistant, setSelectedAssistantId, setSessionByAssistant],
  );

  const openDelegationTargetWorkspaceChat = useCallback(
    async (delegation: DelegationRow) => {
      if (!config?.apiBase) {
        return;
      }
      const sessionStoreKey = chatSessionStoreKey(config.workspaceDir);
      const toId = delegation.toAssistant.trim();
      if (!toId) {
        return;
      }
      setMainView("workspace");
      const mid = delegation.matterId?.trim();
      if (mid) {
        const scope = chatScopeForMatterId(mid, knownChatMatterIdsRef.current);
        chatListScopeRef.current = scope;
        setChatListScope(scope);
        persistChatListScope(sessionStoreKey, scope);
        setContextMatterId(scope);
      }
      setSelectedAssistantId(toId);
      setChatSessionsLoading(true);
      setError(null);
      try {
        const mapped = (await refreshChatSessionListForAssistant(toId)) ?? [];
        const forAssistant = mapped.filter((row) => (row.assistantId?.trim() || toId) === toId);

        let sessionId = delegation.targetSessionId?.trim();
        if (!sessionId || !mapped.some((row) => row.sessionId === sessionId)) {
          sessionId = getStoredActiveChatSessionId(sessionStoreKey, toId);
        }
        if (!sessionId || !forAssistant.some((row) => row.sessionId === sessionId)) {
          sessionId = forAssistant[0]?.sessionId;
        }
        if (!sessionId) {
          const cr = await fetchApi(
            `${config.apiBase}/api/sessions`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                assistantId: toId,
                ...(mid ? { matterId: mid } : {}),
              }),
            },
            { tag: "chat-sessions:delegation-create" },
          );
          const cj = (await readJsonFromResponse(cr)) as {
            ok?: boolean;
            sessionId?: string;
            message?: string;
            error?: string;
            code?: string;
          };
          if (!cr.ok || !cj.sessionId) {
            setError(
              errorMessage(new Error(sessionCreateErrorMessage(cr.status, cj)), "打开子助手对话失败"),
            );
            return;
          }
          sessionId = cj.sessionId;
          await refreshChatSessionListForAssistant(toId);
        }

        if (!sessionId) {
          return;
        }
        noteFocusedChatSessionRef?.current({ assistantId: toId, sessionId });
        persistActiveChatSessionId(sessionStoreKey, toId, sessionId);
        setSessionByAssistant((p) => ({ ...p, [toId]: sessionId }));
        await loadSessionMessagesIntoState(toId, sessionId);
        if (isActiveDelegation(delegation) && delegation.targetSessionId?.trim()) {
          await watchBackgroundSessionFnRef.current({
            sessionId: delegation.targetSessionId.trim(),
            assistantId: toId,
            kind: "delegation",
            hints: {
              complete: `助手 ${delegation.toAssistant} 已完成委派任务`,
              failed: `助手 ${delegation.toAssistant} 委派执行失败，请查看对话`,
              timeout: "委派任务轮询超时，请手动刷新会话查看结果",
            },
          });
        }
        const assistantName =
          assistants.find((a) => a.assistantId === toId)?.displayName ?? toId;
        const modelIdForTarget = readSelectedModelId(toId) ?? selectedModelId;
        const modelLabel =
          modelCatalog.find((m) => m.id === modelIdForTarget)?.label ?? modelIdForTarget;
        flashComposeModelHint(`已打开 ${assistantName} 的会话 · 模型 ${modelLabel}`, 6000);
      } catch (e) {
        setError(errorMessage(e, "打开子助手对话失败"));
      } finally {
        setChatSessionsLoading(false);
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      assistants,
      flashComposeModelHint,
      knownChatMatterIdsRef,
      loadSessionMessagesIntoState,
      modelCatalog,
      refreshChatSessionListForAssistant,
      selectedModelId,
      setContextMatterId,
      setMainView,
      setSelectedAssistantId,
    ],
  );

  const createNewChatSession = useCallback(async () => {
    if (!config?.apiBase) {
      return;
    }
    const assistantId = selectedAssistantId;
    const scope = chatListScopeRef.current;
    setError(null);
    try {
      const cr = await fetchApi(
        `${config.apiBase}/api/sessions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assistantId,
            ...(scope ? { matterId: scope } : {}),
          }),
        },
        { tag: "chat-sessions:create-new" },
      );
      const cj = (await readJsonFromResponse(cr)) as {
        ok?: boolean;
        sessionId?: string;
        title?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!cr.ok || !cj.sessionId) {
        throw new Error(sessionCreateErrorMessage(cr.status, cj));
      }
      const createdId = cj.sessionId;
      const createdRow: ChatSessionListEntry = {
        sessionId: createdId,
        title: lawyerChatListTitle(cj.title),
        updatedAt: new Date().toISOString(),
        ...(scope ? { matterId: scope } : {}),
        assistantId,
      };
      // 目录刷新要等接口；左栏先插这一行，不用等本轮办完。
      setChatSessionList((prev) => upsertChatSessionAtFront(prev, createdRow));
      noteFocusedChatSessionRef?.current({ assistantId, sessionId: createdId });
      persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, createdId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: createdId }));
      const refreshed = await refreshChatSessionListForAssistant(assistantId);
      if (refreshed && !refreshed.some((row) => row.sessionId === createdId)) {
        setChatSessionList((prev) => upsertChatSessionAtFront(prev, createdRow));
      }
      await loadSessionMessagesIntoState(assistantId, createdId, undefined, undefined, (boundMatterId) => {
        rememberOpenedSession(createdId, boundMatterId);
      });
    } catch (cause) {
      setError(errorMessage(cause, "新建对话失败"));
    }
  }, [
    config?.apiBase,
    config?.workspaceDir,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
    rememberOpenedSession,
    selectedAssistantId,
    setChatSessionList,
  ]);

  const renameChatSession = useCallback(
    async (sessionId: string, title: string) => {
      if (!config?.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      const r = await fetchApi(
        `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        },
        { tag: "chat-sessions:rename" },
      );
      const j = (await readJsonFromResponse(r)) as { ok?: boolean; title?: string; message?: string };
      if (!r.ok || j.ok === false) {
        setError(
          errorMessage(
            new Error(typeof j.message === "string" ? j.message : "rename failed"),
            "重命名失败",
          ),
        );
        return;
      }
      const nextTitle = typeof j.title === "string" && j.title.trim() ? j.title : title.trim();
      setChatSessionList((prev) =>
        prev.map((row) => (row.sessionId === sessionId ? { ...row, title: nextTitle } : row)),
      );
    },
    [config?.apiBase, selectedAssistantId],
  );

  const deleteChatSession = useCallback(
    async (target: string | readonly string[]) => {
      if (!config?.apiBase) {
        return;
      }
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const raw of typeof target === "string" ? [target] : target) {
        const sessionId = raw.trim();
        if (!sessionId || seen.has(sessionId)) {
          continue;
        }
        seen.add(sessionId);
        ids.push(sessionId);
      }
      if (ids.length === 0) {
        return;
      }
      const count = ids.length;
      const sessionStoreKey = chatSessionStoreKey(config.workspaceDir);
      if (
        !(await confirmDialog({
          title: count === 1 ? "确定删除此对话？" : `确定删除这 ${count} 条对话？`,
          body: "将移除会话记录、回合与实时进度；已签批或已导出的草稿不会自动删除。",
          confirmLabel: "删除",
          tone: "danger",
        }))
      ) {
        return;
      }
      const cascadeRelated = await confirmDialog({
        title: count === 1 ? "是否同时清理本对话关联内容？" : `是否同时清理这 ${count} 条对话的关联内容？`,
        body:
          count === 1
            ? "· 委派子会话与委派记录\n· 尚未签批、且未导出的草稿与任务\n\n选「取消」则只删除对话本身；关联草稿仍可在改稿 / 在办中单独删除。"
            : "· 委派子会话与委派记录\n· 尚未签批、且未导出的草稿与任务\n\n选「取消」则只删除这些对话本身；关联草稿仍可在改稿 / 在办中单独删除。",
        confirmLabel: "同时清理",
        cancelLabel: "仅删对话",
        tone: "danger",
      });
      setError(null);
      const apiBase = config.apiBase;
      const deletedIds: string[] = [];
      let failure: unknown = null;
      for (const sessionId of ids) {
        const row = chatSessionListRef.current.find((item) => item.sessionId === sessionId);
        const assistantId = row?.assistantId?.trim() || selectedAssistantId;
        abortLiveChatSessionRef?.current(sessionId);
        try {
          const r = await fetchApi(
            `${apiBase}/api/sessions/delete`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                sessionId,
                assistantId,
                cascadeDelegations: cascadeRelated,
                cascadeUnapprovedDrafts: cascadeRelated,
              }),
            },
            { tag: "chat-sessions:delete" },
          );
          const j = (await readJsonFromResponse(r)) as { ok?: boolean; message?: string };
          if (!r.ok || j.ok === false) {
            throw new Error(typeof j.message === "string" ? j.message : "delete failed");
          }
          clearPlanHandoff(sessionId);
          void deleteSessionPlanHandoff(apiBase, sessionId);
          deletedIds.push(sessionId);
          setChatSessionList((prev) => prev.filter((item) => item.sessionId !== sessionId));
        } catch (cause) {
          failure = cause;
          break;
        }
      }
      if (deletedIds.length === 0) {
        if (failure) {
          setError(errorMessage(failure, "删除对话失败"));
        }
        return;
      }
      const deleted = new Set(deletedIds);
      const selectedOpen = sessionByAssistant[selectedAssistantId];
      const openAssistantId =
        selectedOpen && deleted.has(selectedOpen)
          ? selectedAssistantId
          : Object.entries(sessionByAssistant).find(([, sessionId]) =>
              Boolean(sessionId && deleted.has(sessionId)),
            )?.[0];
      // Drop every assistant mapping that still points at a deleted conversation.
      setSessionByAssistant((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [assistantId, sessionId] of Object.entries(prev)) {
          if (sessionId && deleted.has(sessionId)) {
            next[assistantId] = undefined;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setMessagesByAssistant?.((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [assistantId, sessionId] of Object.entries(sessionByAssistant)) {
          if (sessionId && deleted.has(sessionId)) {
            next[assistantId] = [];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      try {
        const list = await refreshChatSessionListForAssistant(selectedAssistantId);
        if (!openAssistantId) {
          return;
        }
        const scope = chatListScopeRef.current;
        const remaining = (list ?? []).filter((item) =>
          isSessionInChatScope(item, scope, knownChatMatterIdsRef.current),
        );
        const next = remaining[0];
        if (!next) {
          noteFocusedChatSessionRef?.current({ assistantId: openAssistantId, sessionId: undefined });
          setContextMatterId(scope);
          return;
        }
        const nextAssistantId = next.assistantId?.trim() || openAssistantId;
        noteFocusedChatSessionRef?.current({
          assistantId: nextAssistantId,
          sessionId: next.sessionId,
        });
        persistActiveChatSessionId(sessionStoreKey, nextAssistantId, next.sessionId);
        setSessionByAssistant((prev) => ({ ...prev, [nextAssistantId]: next.sessionId }));
        if (nextAssistantId !== selectedAssistantId) {
          setSelectedAssistantId(nextAssistantId);
        }
        await loadSessionMessagesIntoState(
          nextAssistantId,
          next.sessionId,
          undefined,
          undefined,
          (boundMatterId) => {
            rememberOpenedSession(next.sessionId, boundMatterId);
          },
        );
      } catch (cause) {
        failure = failure ?? cause;
      } finally {
        if (failure) {
          setError(errorMessage(failure, "删除对话失败"));
        }
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      loadSessionMessagesIntoState,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sessionByAssistant,
      setChatSessionList,
      setMessagesByAssistant,
      setSessionByAssistant,
      setSelectedAssistantId,
      setContextMatterId,
      knownChatMatterIdsRef,
      noteFocusedChatSessionRef,
      abortLiveChatSessionRef,
      rememberOpenedSession,
    ],
  );

  useEffect(() => {
    if (!config?.apiBase) {
      return undefined;
    }
    const ac = new AbortController();
    void hydrateWorkspaceChatSessions(ac.signal);
    return () => ac.abort();
  }, [config?.apiBase, config?.workspaceDir, hydrateWorkspaceChatSessions]);

  useEffect(() => {
    const sessionId = sessionByAssistant[selectedAssistantId];
    if (!sessionId) {
      return;
    }
    const row = chatSessionList.find((item) => item.sessionId === sessionId);
    if (!row) {
      return;
    }
    // 工作台「用于对话」在下一句发送后会改绑。列表刷新后，切换器跟着这场对话走。
    const next = chatScopeForMatterId(row.matterId, knownChatMatterIdsRef.current);
    if (next === chatListScopeRef.current) {
      return;
    }
    chatListScopeRef.current = next;
    setChatListScope(next);
    persistChatListScope(chatSessionStoreKey(config?.workspaceDir), next);
  }, [chatSessionList, config?.workspaceDir, knownChatMatterIdsRef, knownChatMatterTick, selectedAssistantId, sessionByAssistant]);

  const openChatListScope = useCallback(
    async (scope: string | null) => {
      const assistantId = selectedAssistantIdRef.current;
      const storeKey = chatSessionStoreKey(config?.workspaceDir);
      chatListScopeRef.current = scope;
      setChatListScope(scope);
      persistChatListScope(storeKey, scope);
      const pick = pickChatSessionForScope(chatSessionListRef.current, scope, knownChatMatterIdsRef.current, {
        storedSessionId: getStoredScopeSessionId(storeKey, scope),
      });
      if (!pick) {
        noteFocusedChatSessionRef?.current({ assistantId, sessionId: undefined });
        setSessionByAssistant((prev) => ({ ...prev, [assistantId]: undefined }));
        setMessagesByAssistant?.((prev) => ({ ...prev, [assistantId]: [] }));
        setContextMatterId(scope);
        return;
      }
      const openAssistantId = pick.assistantId?.trim() || assistantId;
      setSessionByAssistant((prev) => ({ ...prev, [openAssistantId]: pick.sessionId }));
      setContextMatterId(chatScopeForMatterId(pick.matterId, knownChatMatterIdsRef.current));
      await selectChatSession(pick.sessionId, openAssistantId);
    },
    [
      config?.workspaceDir,
      knownChatMatterIdsRef,
      selectChatSession,
      setContextMatterId,
      setMessagesByAssistant,
      setSessionByAssistant,
    ],
  );

  const focusAssistantInCurrentScope = useCallback(
    async (assistantId: string) => {
      const scope = chatListScopeRef.current;
      setSelectedAssistantId(assistantId);
      const storeKey = chatSessionStoreKey(config?.workspaceDir);
      const pick = pickChatSessionForScope(chatSessionListRef.current, scope, knownChatMatterIdsRef.current, {
        assistantId,
        storedSessionId: getStoredScopeSessionId(storeKey, scope),
      });
      if (!pick) {
        noteFocusedChatSessionRef?.current({ assistantId, sessionId: undefined });
        setSessionByAssistant((prev) => ({ ...prev, [assistantId]: undefined }));
        setMessagesByAssistant?.((prev) => ({ ...prev, [assistantId]: [] }));
        setContextMatterId(scope);
        return;
      }
      setSessionByAssistant((prev) => ({ ...prev, [assistantId]: pick.sessionId }));
      setContextMatterId(chatScopeForMatterId(pick.matterId, knownChatMatterIdsRef.current));
      await selectChatSession(pick.sessionId, assistantId);
    },
    [
      config?.workspaceDir,
      knownChatMatterIdsRef,
      selectChatSession,
      setContextMatterId,
      setMessagesByAssistant,
      setSelectedAssistantId,
      setSessionByAssistant,
    ],
  );

  return {
    chatListScope,
    hydrateWorkspaceChatSessions,
    selectChatSession,
    openChatListScope,
    focusAssistantInCurrentScope,
    openDelegationTargetWorkspaceChat,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
  };
}
