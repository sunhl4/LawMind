import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import type { ChatActivityBlock } from "./lawmind-chat-activity.js";
import type { ChatLiveTrace } from "./lawmind-chat-trace.js";
import type { ChatMsg } from "./lawmind-chat";
import { parseRequiresActionsFromResponse } from "./lawmind-requires-action";
import type { ChatSessionListEntry } from "./lawmind-chat-active-storage";

export type { ChatMsg } from "./lawmind-chat";
export type { ChatSessionListEntry } from "./lawmind-chat-active-storage";
export {
  chatSessionStoreKey,
  clearStoredActiveChatSessionForAssistant,
  getStoredActiveChatSessionId,
  persistActiveChatSessionId,
  readChatActiveStore,
} from "./lawmind-chat-active-storage";

export type LawmindChatShellState = {
  messagesByAssistant: Record<string, ChatMsg[]>;
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  sessionByAssistant: Record<string, string | undefined>;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  chatSessionList: ChatSessionListEntry[];
  setChatSessionList: Dispatch<SetStateAction<ChatSessionListEntry[]>>;
  chatSessionsLoading: boolean;
  setChatSessionsLoading: Dispatch<SetStateAction<boolean>>;
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
  refreshChatSessionListForAssistant: (
    assistantId: string,
  ) => Promise<ChatSessionListEntry[] | null>;
};

/** Chat message map, session ids, and session list loaders for the app shell. */
export function useLawmindChatShell(input: {
  apiBase: string | undefined;
  selectedAssistantId: string;
}): LawmindChatShellState {
  const { apiBase, selectedAssistantId } = input;
  const [messagesByAssistant, setMessagesByAssistant] = useState<Record<string, ChatMsg[]>>({});
  const [sessionByAssistant, setSessionByAssistant] = useState<
    Record<string, string | undefined>
  >({});
  const [chatSessionList, setChatSessionList] = useState<ChatSessionListEntry[]>([]);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);

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
      },
    ) => {
      if (!apiBase) {
        return;
      }
      const r = await fetch(
        `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        { signal, headers: apiAuthHeaders() },
      );
      const j = (await r.json()) as {
        ok?: boolean;
        messages?: Array<{
          role: string;
          text?: string;
          content?: string;
          requiresAction?: unknown;
          liveTrace?: ChatLiveTrace;
          executionState?: ChatMsg["executionState"];
        }>;
      };
      if (!j.ok || !Array.isArray(j.messages)) {
        return;
      }
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
          };
        });
      if (overlay?.liveTrace || overlay?.activity || overlay?.executionState) {
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
            };
          }
        }
      }
      setMessagesByAssistant((p) => ({ ...p, [assistantId]: msgs }));
    },
    [apiBase],
  );

  const refreshChatSessionListForAssistant = useCallback(
    async (assistantId: string): Promise<ChatSessionListEntry[] | null> => {
      if (!apiBase) {
        return null;
      }
      const r = await fetch(
        `${apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
        { headers: apiAuthHeaders() },
      );
      const j = (await r.json()) as {
        ok?: boolean;
        sessions?: Array<{
          sessionId: string;
          title?: string;
          updatedAt: string;
          lastPreview?: string;
        }>;
      };
      if (!j.ok || !Array.isArray(j.sessions)) {
        return null;
      }
      const mapped: ChatSessionListEntry[] = j.sessions.map((s) => ({
        sessionId: s.sessionId,
        title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
        updatedAt: s.updatedAt,
        lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
      }));
      if (assistantId !== selectedAssistantId) {
        return null;
      }
      setChatSessionList(mapped);
      return mapped;
    },
    [apiBase, selectedAssistantId],
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
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
  };
}
