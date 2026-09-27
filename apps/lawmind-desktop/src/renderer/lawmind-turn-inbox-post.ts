import { useCallback, useEffect, useState } from "react";
import { apiSendJson } from "./api-client";
import { turnInboxAck } from "./lawmind-chat";

/** Mid-turn steer / pin POST. The note is the lawyer-facing ack, not a second confirmation. */
export function postTurnInbox(
  apiBase: string,
  sessionId: string,
  kind: "steer" | "pins",
  payload: unknown,
  onNote: (note: string) => void,
): void {
  const path = kind === "steer" ? "steer" : "inject";
  void apiSendJson<{ dropped?: number; truncated?: boolean }>(
    apiBase,
    `/api/sessions/${encodeURIComponent(sessionId)}/${path}`,
    "POST",
    payload,
  )
    .then((body) => {
      onNote(
        turnInboxAck({
          kind,
          dropped: body.dropped,
          truncated: body.truncated,
        }),
      );
    })
    .catch(() => {
      onNote(turnInboxAck({ kind, failed: true }));
    });
}

/** Clears the ack when the turn is no longer running. */
export function useTurnInboxNote(loading: boolean): {
  note: string | null;
  post: (kind: "steer" | "pins", payload: unknown, apiBase: string, sessionId: string) => void;
} {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) {
      setNote(null);
    }
  }, [loading]);
  const post = useCallback(
    (kind: "steer" | "pins", payload: unknown, apiBase: string, sessionId: string) => {
      postTurnInbox(apiBase, sessionId, kind, payload, setNote);
    },
    [],
  );
  return { note, post };
}
