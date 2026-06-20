import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { errorMessage } from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import { fetchChatLiveTurnProgress } from "./lawmind-chat-trace.js";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { DelegationRow } from "./lawmind-app-data";
import { isActiveDelegation } from "./lawmind-delegation-status";
import type { ChatSessionListEntry } from "./useLawmindChatShell";
import {
  chatSessionStoreKey,
  getStoredActiveChatSessionId,
  persistActiveChatSessionId,
} from "./useLawmindChatShell";
import { readSelectedModelId } from "./lawmind-selected-model-pref";
import type { BackgroundWatchOpts } from "./useLawmindBackgroundWatch";

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
  ) => Promise<void>;
  refreshChatSessionListForAssistant: (assistantId: string) => Promise<ChatSessionListEntry[] | null>;
  watchBackgroundSessionFnRef: MutableRefObject<(opts: BackgroundWatchOpts) => Promise<void>>;
  setMainView: (v: "workspace" | "collaboration" | "review") => void;
  setSelectedAssistantId: (id: string) => void;
  setContextMatterId: (id: string | null) => void;
  assistants: Array<{ assistantId: string; displayName: string }>;
  modelCatalog: Array<{ id: string; label: string }>;
  selectedModelId: string;
  flashComposeModelHint: (msg: string, ms?: number) => void;
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
  } = input;

  const hydrateWorkspaceChatSessions = useCallback(
    async (signal: AbortSignal) => {
      const assistantId = selectedAssistantId;
      if (!config?.apiBase) {
        setChatSessionList([]);
        return;
      }
      const sessionStoreKey = chatSessionStoreKey(config.workspaceDir);
      setChatSessionsLoading(true);
      try {
        const listRes = await fetch(
          `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
          { signal, headers: apiAuthHeaders() },
        );
        const listJ = (await listRes.json()) as {
          ok?: boolean;
          sessions?: Array<{
            sessionId: string;
            title?: string;
            updatedAt: string;
            lastPreview?: string;
          }>;
        };
        if (signal.aborted) {
          return;
        }
        const mapped: ChatSessionListEntry[] = (Array.isArray(listJ.sessions) ? listJ.sessions : []).map(
          (s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
            lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
          }),
        );
        setChatSessionList(mapped);

        let sessionId = getStoredActiveChatSessionId(sessionStoreKey, assistantId);
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = mapped[0]?.sessionId;
        }
        if (!sessionId) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...apiAuthHeaders() },
            body: JSON.stringify({ assistantId }),
            signal,
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (signal.aborted) {
            return;
          }
          if (!cr.ok || !cj.sessionId) {
            setError(
              errorMessage(
                new Error(typeof cj.message === "string" ? cj.message : "create session failed"),
                "创建对话失败",
              ),
            );
            return;
          }
          sessionId = cj.sessionId;
          const listRes2 = await fetch(
            `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
            { signal, headers: apiAuthHeaders() },
          );
          const listJ2 = (await listRes2.json()) as {
            ok?: boolean;
            sessions?: Array<{
            sessionId: string;
            title?: string;
            updatedAt: string;
            lastPreview?: string;
          }>;
          };
          if (signal.aborted) {
            return;
          }
          const mapped2: ChatSessionListEntry[] = (
            Array.isArray(listJ2.sessions) ? listJ2.sessions : []
          ).map((s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
            lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
          }));
          setChatSessionList(mapped2);
        }

        if (signal.aborted || !sessionId) {
          return;
        }
        persistActiveChatSessionId(sessionStoreKey, assistantId, sessionId);
        setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
        await loadSessionMessagesIntoState(assistantId, sessionId, signal);
        if (!signal.aborted && config?.apiBase) {
          try {
            const live = await fetchChatLiveTurnProgress(config.apiBase, sessionId, signal);
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
    [config, loadSessionMessagesIntoState, selectedAssistantId],
  );

  const selectChatSession = useCallback(
    async (sessionId: string) => {
      if (!config?.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, sessionId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
      await loadSessionMessagesIntoState(assistantId, sessionId);
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
    },
    [config, loadSessionMessagesIntoState, selectedAssistantId],
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
        setContextMatterId(mid);
      }
      setSelectedAssistantId(toId);
      setChatSessionsLoading(true);
      setError(null);
      try {
        const listRes = await fetch(
          `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(toId)}`,
          { headers: apiAuthHeaders() },
        );
        const listJ = (await listRes.json()) as {
          ok?: boolean;
          sessions?: Array<{
            sessionId: string;
            title?: string;
            updatedAt: string;
            lastPreview?: string;
          }>;
        };
        const mapped: ChatSessionListEntry[] = (Array.isArray(listJ.sessions) ? listJ.sessions : []).map(
          (s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
            lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
          }),
        );
        setChatSessionList(mapped);

        let sessionId = delegation.targetSessionId?.trim();
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = getStoredActiveChatSessionId(sessionStoreKey, toId);
        }
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = mapped[0]?.sessionId;
        }
        if (!sessionId) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...apiAuthHeaders() },
            body: JSON.stringify({ assistantId: toId }),
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (!cr.ok || !cj.sessionId) {
            setError(
              errorMessage(
                new Error(typeof cj.message === "string" ? cj.message : "create session failed"),
                "打开子助手对话失败",
              ),
            );
            return;
          }
          sessionId = cj.sessionId;
          const listRes2 = await fetch(
            `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(toId)}`,
            { headers: apiAuthHeaders() },
          );
          const listJ2 = (await listRes2.json()) as {
            ok?: boolean;
            sessions?: Array<{
            sessionId: string;
            title?: string;
            updatedAt: string;
            lastPreview?: string;
          }>;
          };
          const mapped2: ChatSessionListEntry[] = (
            Array.isArray(listJ2.sessions) ? listJ2.sessions : []
          ).map((s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
            lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
          }));
          setChatSessionList(mapped2);
        }

        if (!sessionId) {
          return;
        }
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
      loadSessionMessagesIntoState,
      modelCatalog,
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
    setError(null);
    try {
      const cr = await fetch(`${config.apiBase}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...apiAuthHeaders() },
        body: JSON.stringify({ assistantId }),
      });
      const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
      if (!cr.ok || !cj.sessionId) {
        throw new Error(typeof cj.message === "string" ? cj.message : "create session failed");
      }
      await refreshChatSessionListForAssistant(assistantId);
      persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, cj.sessionId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: cj.sessionId! }));
      await loadSessionMessagesIntoState(assistantId, cj.sessionId);
    } catch (cause) {
      setError(errorMessage(cause, "新建对话失败"));
    }
  }, [
    config?.apiBase,
    config?.workspaceDir,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
    selectedAssistantId,
  ]);

  const renameChatSession = useCallback(
    async (sessionId: string, title: string) => {
      if (!config?.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      const r = await fetch(
        `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", ...apiAuthHeaders() },
          body: JSON.stringify({ title }),
        },
      );
      const j = (await r.json()) as { ok?: boolean; title?: string; message?: string };
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
    async (sessionId: string) => {
      if (!config?.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      const sessionStoreKey = chatSessionStoreKey(config.workspaceDir);
      if (!window.confirm("确定删除此对话？该会话将从本工作区移除且不可恢复。")) {
        return;
      }
      setError(null);
      try {
        const r = await fetch(`${config.apiBase}/api/sessions/delete`, {
          method: "POST",
          headers: { "content-type": "application/json", ...apiAuthHeaders() },
          body: JSON.stringify({ sessionId, assistantId }),
        });
        const j = (await r.json()) as { ok?: boolean; message?: string };
        if (!r.ok || j.ok === false) {
          throw new Error(typeof j.message === "string" ? j.message : "delete failed");
        }
        const wasActive = sessionByAssistant[assistantId] === sessionId;
        const list = await refreshChatSessionListForAssistant(assistantId);
        if (list === null) {
          return;
        }
        if (!wasActive) {
          return;
        }
        if (list.length === 0) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...apiAuthHeaders() },
            body: JSON.stringify({ assistantId }),
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (!cr.ok || !cj.sessionId) {
            throw new Error(typeof cj.message === "string" ? cj.message : "create failed");
          }
          await refreshChatSessionListForAssistant(assistantId);
          persistActiveChatSessionId(chatSessionStoreKey(config.workspaceDir), assistantId, cj.sessionId);
          setSessionByAssistant((p) => ({ ...p, [assistantId]: cj.sessionId! }));
          await loadSessionMessagesIntoState(assistantId, cj.sessionId);
          return;
        }
        const nextId = list[0].sessionId;
        persistActiveChatSessionId(sessionStoreKey, assistantId, nextId);
        setSessionByAssistant((p) => ({ ...p, [assistantId]: nextId }));
        await loadSessionMessagesIntoState(assistantId, nextId);
      } catch (cause) {
        setError(errorMessage(cause, "删除对话失败"));
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      loadSessionMessagesIntoState,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sessionByAssistant,
    ],
  );

  useEffect(() => {
    if (!config?.apiBase) {
      return undefined;
    }
    const ac = new AbortController();
    void hydrateWorkspaceChatSessions(ac.signal);
    return () => ac.abort();
  }, [config?.apiBase, config?.workspaceDir, selectedAssistantId, hydrateWorkspaceChatSessions]);

  return {
    hydrateWorkspaceChatSessions,
    selectChatSession,
    openDelegationTargetWorkspaceChat,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
  };
}
