// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import type { ChatActivityBlock } from "./lawmind-chat-activity.js";
import type { ChatLiveTrace } from "./lawmind-chat-trace.js";
import type { ChatMsg } from "./lawmind-chat";
import { parseRequiresActionsFromResponse } from "./lawmind-requires-action";
import type { ChatSessionListEntry } from "./lawmind-chat-active-storage";
import type { CarryoverOrigin } from "./LawmindMsgCarryoverNotice";
import { mapChatSessionListPayload } from "./lawmind-chat-session-list";

export type { ChatMsg } from "./lawmind-chat";
export type { ChatSessionListEntry } from "./lawmind-chat-active-storage";
export {
  chatSessionStoreKey,
  clearStoredActiveChatSessionForAssistant,
  getStoredActiveChatSessionId,
  getStoredScopeSessionId,
  persistActiveChatSessionId,
  persistChatListScope,
  persistScopeSessionId,
  readChatActiveStore,
  readStoredChatListScope,
} from "./lawmind-chat-active-storage";

/** 无标题会话的默认显示名（律师向中文，统一一处）。 */
export const DEFAULT_CHAT_SESSION_TITLE = "新对话";

export type LawmindChatShellState = {
  messagesByAssistant: Record<string, ChatMsg[]>;
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  sessionByAssistant: Record<string, string | undefined>;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  chatSessionList: ChatSessionListEntry[];
  setChatSessionList: Dispatch<SetStateAction<ChatSessionListEntry[]>>;
  chatSessionsLoading: boolean;
  setChatSessionsLoading: Dispatch<SetStateAction<boolean>>;
  /** 各会话的「续接来源」（`/api/sessions/:id` 的 `carriedOverFrom`）；用于顶部续接卡。 */
  carriedOverFromBySession: Record<string, CarryoverOrigin>;
  loadSessionMessagesIntoState: (
    assistantId: string,
    sessionId: string,
    signal?: AbortSignal,
    overlay?: {
      liveTrace?: ChatLiveTrace;
      activity?: ChatActivityBlock[];
      activityActive?: boolean;
      executionState?: ChatMsg["executionState"];
      turnPlan?: ChatMsg["turnPlan"];
    },
    /**
     * 打开一条对话后回传它还绑着哪一案（未绑案为 null）。
     * 前台打开走这个回调同步 compose 案件芯片；后台轮询不传，避免别的会话改掉律师当前的选择。
     */
    onSessionMatter?: (matterId: string | null) => void,
  ) => Promise<boolean>;
  refreshChatSessionListForAssistant: (
    assistantId: string,
  ) => Promise<ChatSessionListEntry[] | null>;
};

/** Chat message map, session ids, and session list loaders for the app shell. */
export function useLawmindChatShell(input: {
  apiBase: string | undefined;
  selectedAssistantId: string;
}): LawmindChatShellState {
  const { apiBase } = input;
  const [messagesByAssistant, setMessagesByAssistant] = useState<Record<string, ChatMsg[]>>({});
  const [sessionByAssistant, setSessionByAssistant] = useState<
    Record<string, string | undefined>
  >({});
  const [chatSessionList, setChatSessionList] = useState<ChatSessionListEntry[]>([]);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);
  const [carriedOverFromBySession, setCarriedOverFromBySession] = useState<
    Record<string, CarryoverOrigin>
  >({});

  const loadSessionMessagesIntoState = useCallback(
    async (
      assistantId: string,
      sessionId: string,
      signal?: AbortSignal,
      overlay?: {
        liveTrace?: ChatLiveTrace;
        activity?: ChatActivityBlock[];
        activityActive?: boolean;
        executionState?: ChatMsg["executionState"];
        turnPlan?: ChatMsg["turnPlan"];
      },
      onSessionMatter?: (matterId: string | null) => void,
    ): Promise<boolean> => {
      if (!apiBase) {
        return false;
      }
      const r = await fetch(
        `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        { signal, headers: apiAuthHeaders() },
      );
      const j = (await r.json()) as {
        ok?: boolean;
        matterId?: string | null;
        carriedOverFrom?: CarryoverOrigin;
        messages?: Array<{
          role: string;
          text?: string;
          content?: string;
          requiresAction?: unknown;
          liveTrace?: ChatLiveTrace;
          executionState?: ChatMsg["executionState"];
          turnPlan?: ChatMsg["turnPlan"];
        }>;
      };
      if (!j.ok || !Array.isArray(j.messages)) {
        return false;
      }
      // 「续接来源」卡：本会话是从哪条对话带过来的（没有就清掉，避免换会话后残留）。
      setCarriedOverFromBySession((prev) => {
        const had = Boolean(prev[sessionId]);
        if (j.carriedOverFrom && typeof j.carriedOverFrom === "object") {
          return { ...prev, [sessionId]: j.carriedOverFrom };
        }
        if (!had) {
          return prev;
        }
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      const msgs: ChatMsg[] = j.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const requiresAction = parseRequiresActionsFromResponse(m.requiresAction);
          return {
            role: m.role as "user" | "assistant",
            text:
              typeof m.text === "string"
                ? m.text
                : typeof m.content === "string"
                  ? m.content
                  : "",
            ...(m.liveTrace ? { liveTrace: m.liveTrace } : {}),
            ...(m.executionState ? { executionState: m.executionState } : {}),
            ...(requiresAction.length > 0 ? { requiresAction } : {}),
            ...(m.turnPlan ? { turnPlan: m.turnPlan } : {}),
          };
        });
      if (overlay?.liveTrace || overlay?.activity || overlay?.executionState || overlay?.turnPlan) {
        if (msgs.length > 0) {
          const idx = msgs.length - 1;
          const row = msgs[idx];
          if (row.role === "assistant") {
            msgs[idx] = {
              ...row,
              ...(overlay.liveTrace ? { liveTrace: overlay.liveTrace } : {}),
              ...(overlay.activity ? { activity: overlay.activity } : {}),
              ...(overlay.activityActive !== undefined
                ? { activityActive: overlay.activityActive }
                : {}),
              ...(overlay.executionState ? { executionState: overlay.executionState } : {}),
              ...(overlay.turnPlan ? { turnPlan: overlay.turnPlan } : {}),
            };
          }
        }
      }
      setMessagesByAssistant((p) => ({ ...p, [assistantId]: msgs }));
      const boundMatterId =
        typeof j.matterId === "string" && j.matterId.trim() ? j.matterId.trim() : null;
      onSessionMatter?.(boundMatterId);
      return true;
    },
    [apiBase],
  );

  const refreshChatSessionListForAssistant = useCallback(
    async (_assistantId: string): Promise<ChatSessionListEntry[] | null> => {
      if (!apiBase) {
        return null;
      }
      // 左栏按案件分档，列表必须带上其他助手的对话。按助手过滤会把它们藏起来。
      const r = await fetch(`${apiBase}/api/sessions`, { headers: apiAuthHeaders() });
      const j = (await r.json()) as {
        ok?: boolean;
        sessions?: Array<{
          sessionId: string;
          title?: string;
          updatedAt: string;
          lastPreview?: string;
          matterId?: string | null;
          assistantId?: string;
          forkedToSessionId?: string;
        }>;
      };
      if (!j.ok || !Array.isArray(j.sessions)) {
        return null;
      }
      const mapped = mapChatSessionListPayload(j.sessions);
      if (!mapped) {
        return null;
      }
      setChatSessionList(mapped);
      return mapped;
    },
    [apiBase],
  );

  return {
    messagesByAssistant,
    setMessagesByAssistant,
    sessionByAssistant,
    setSessionByAssistant,
    chatSessionList,
    setChatSessionList,
    chatSessionsLoading,
    setChatSessionsLoading,
    carriedOverFromBySession,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
  };
}
