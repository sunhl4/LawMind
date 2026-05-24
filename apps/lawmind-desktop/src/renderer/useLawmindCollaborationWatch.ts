import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { appendChatMessage, type ChatMsg } from "./lawmind-chat";
import {
  activityFromLiveTrace,
} from "./lawmind-chat-activity.js";
import {
  fetchDelegationSessionProgress,
  finalizeLiveTrace,
  liveTraceFromServerProgress,
  liveTracesEqual,
  mergeDelegationLiveTraces,
  type ChatLiveTrace,
} from "./lawmind-chat-trace.js";
import { formatDelegationFollowUpBubble } from "./lawmind-chat-active-storage";

type AssistantRow = { assistantId: string; displayName: string };

export function useLawmindCollaborationWatch(input: {
  apiBase: string | undefined;
  selectedAssistantId: string;
  sessionByAssistant: Record<string, string | undefined>;
  assistants: AssistantRow[];
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
}): void {
  const { apiBase, selectedAssistantId, sessionByAssistant, assistants, setMessagesByAssistant } =
    input;
  const delegationFollowUpSeenRef = useRef(new Set<string>());
  const delegationFollowUpSessionKeyRef = useRef<string>("");
  const delegationTraceSnapshotRef = useRef<Map<string, ChatLiveTrace>>(new Map());

  useEffect(() => {
    const sid = sessionByAssistant[selectedAssistantId];
    const nextKey = `${selectedAssistantId}:${sid ?? ""}`;
    if (delegationFollowUpSessionKeyRef.current !== nextKey) {
      delegationFollowUpSessionKeyRef.current = nextKey;
      delegationFollowUpSeenRef.current.clear();
    }
  }, [selectedAssistantId, sessionByAssistant]);

  useEffect(() => {
    if (!apiBase) {
      return undefined;
    }
    const assistantId = selectedAssistantId;
    const sessionId = sessionByAssistant[assistantId]?.trim();
    if (!sessionId) {
      return undefined;
    }

    const tick = async () => {
      try {
        const delegationProgress = await fetchDelegationSessionProgress(
          apiBase,
          sessionId,
          assistantId,
        );
        const assistantDisplayById = Object.fromEntries(
          assistants.map((a) => [a.assistantId, a.displayName]),
        );
        const mergedDelegationTrace = mergeDelegationLiveTraces(
          delegationProgress.items,
          assistantDisplayById,
        );
        if (mergedDelegationTrace?.active) {
          for (const item of delegationProgress.items) {
            const id = item.delegationId?.trim();
            if (!id || !item.progress) {
              continue;
            }
            delegationTraceSnapshotRef.current.set(
              id,
              liveTraceFromServerProgress(item.progress),
            );
          }
          setMessagesByAssistant((previous) => {
            const list = previous[assistantId] ?? [];
            if (list.length === 0) {
              return previous;
            }
            const idx = list.length - 1;
            const row = list[idx];
            if (
              row.liveTrace?.active &&
              mergedDelegationTrace &&
              liveTracesEqual(row.liveTrace, mergedDelegationTrace)
            ) {
              return previous;
            }
            if (row.liveTrace?.active) {
              return previous;
            }
            const nextList = list.slice();
            const delegationActivity = activityFromLiveTrace(mergedDelegationTrace);
            if (row.role === "assistant") {
              nextList[idx] = {
                ...row,
                liveTrace: mergedDelegationTrace,
                activity: delegationActivity,
                activityActive: true,
              };
            } else {
              nextList.push({
                role: "assistant",
                text: "",
                liveTrace: mergedDelegationTrace,
                activity: delegationActivity,
                activityActive: true,
              });
            }
            return { ...previous, [assistantId]: nextList };
          });
        }

        const url = `${apiBase}/api/delegations/follow-up?sessionId=${encodeURIComponent(sessionId)}&assistantId=${encodeURIComponent(assistantId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          return;
        }
        const j = (await res.json()) as {
          ok?: boolean;
          items?: Array<{
            delegationId: string;
            status: string;
            toAssistant: string;
            result?: string;
            error?: string;
          }>;
        };
        if (!j.ok || !Array.isArray(j.items)) {
          return;
        }
        for (const it of j.items) {
          const id = it.delegationId;
          if (!id || delegationFollowUpSeenRef.current.has(id)) {
            continue;
          }
          delegationFollowUpSeenRef.current.add(id);
          const snap = delegationTraceSnapshotRef.current.get(id);
          delegationTraceSnapshotRef.current.delete(id);
          const text = formatDelegationFollowUpBubble(it, assistantDisplayById);
          setMessagesByAssistant((previous) =>
            appendChatMessage(previous, assistantId, {
              role: "assistant",
              text,
              liveTrace: snap
                ? finalizeLiveTrace({
                    ...snap,
                    active: false,
                    steps: snap.steps.map((s) =>
                      s.status === "running"
                        ? {
                            ...s,
                            status: it.status === "completed" ? ("done" as const) : ("failed" as const),
                          }
                        : s,
                    ),
                  })
                : undefined,
            }),
          );
          const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
          const ok = it.status === "completed";
          const who = assistantDisplayById[it.toAssistant.trim()]?.trim() || it.toAssistant;
          const shortBody = ok ? `助手 ${who} 已完成委派任务` : `助手 ${who} 委派未成功`;
          if (desk?.showNotification) {
            void desk.showNotification({
              title: ok ? "LawMind · 委派已完成" : "LawMind · 委派未成功",
              body: shortBody,
              openChatOnClick: true,
              chatAssistantId: assistantId,
            });
          }
        }
      } catch {
        /* ignore */
      }
    };

    const interval = window.setInterval(() => void tick(), 3500);
    void tick();
    return () => window.clearInterval(interval);
  }, [apiBase, selectedAssistantId, sessionByAssistant, assistants, setMessagesByAssistant]);
}
