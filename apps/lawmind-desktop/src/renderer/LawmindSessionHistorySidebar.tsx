import { useCallback, useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "./api-client";

export type SessionHistoryRow = {
  sessionId: string;
  title: string;
  updatedAt: string;
  lastPreview?: string;
};

type Props = {
  apiBase: string;
  assistantId: string;
  sessions: SessionHistoryRow[];
  activeSessionId?: string;
  busy?: boolean;
  onSelect: (sessionId: string) => void | Promise<void>;
  onResumed?: () => void | Promise<void>;
};

export function LawmindSessionHistorySidebar({
  apiBase,
  assistantId: _assistantId,
  sessions,
  activeSessionId,
  busy,
  onSelect,
  onResumed,
}: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      setResumeBusyId(sessionId);
      setResumeError(null);
      try {
        await apiSendJson(apiBase, `/api/sessions/${encodeURIComponent(sessionId)}/resume`, "POST", {});
        await onSelect(sessionId);
        await onResumed?.();
      } catch (e) {
        setResumeError(errorMessage(e, "恢复会话失败"));
      } finally {
        setResumeBusyId(null);
      }
    },
    [apiBase, onResumed, onSelect],
  );

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="lm-session-history-sidebar">
      <button
        type="button"
        className="lm-btn lm-btn-ghost lm-btn-small lm-session-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "收起历史" : `会话历史 (${sessions.length})`}
      </button>
      {open ? (
        <ul className="lm-session-history-list" aria-label="会话历史">
          {sessions.map((row) => {
            const active = row.sessionId === activeSessionId;
            return (
              <li
                key={row.sessionId}
                className={`lm-session-history-row ${active ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="lm-session-history-title"
                  disabled={busy}
                  onClick={() => void onSelect(row.sessionId)}
                >
                  {row.title}
                </button>
                {row.lastPreview ? (
                  <p className="lm-meta lm-session-history-preview">{row.lastPreview}</p>
                ) : null}
                <div className="lm-session-history-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-small"
                    disabled={busy || resumeBusyId === row.sessionId}
                    title="从 JSONL transcript 修复并加载会话"
                    onClick={() => void resumeSession(row.sessionId)}
                  >
                    {resumeBusyId === row.sessionId ? "恢复中…" : "从 transcript 恢复"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {resumeError ? <p className="lm-meta lm-callout-warn">{resumeError}</p> : null}
    </div>
  );
}
