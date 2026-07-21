import { useEffect, useState, type ReactNode } from "react";
import { LawmindChatExecutionTrace } from "./LawmindChatExecutionTrace";
import { loadFleetTranscript, type FleetTranscriptPayload } from "./lawmind-agent-fleet-api";
import { errorMessage } from "./api-client";

type Props = {
  apiBase: string;
  sessionId: string | null;
  onClose: () => void;
};

export function LawmindAgentFleetTranscript({ apiBase, sessionId, onClose }: Props): ReactNode {
  const [payload, setPayload] = useState<FleetTranscriptPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !apiBase) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    void loadFleetTranscript(apiBase, sessionId)
      .then((p) => setPayload(p))
      .catch((e) => setError(errorMessage(e, "无法加载办理过程")))
      .finally(() => setLoading(false));
  }, [apiBase, sessionId]);

  if (!sessionId) {
    return (
      <aside className="lm-agent-fleet-transcript lm-agent-fleet-transcript-empty" aria-label="办理过程">
        <p className="lm-meta">选中左侧一件事，可在此查看办理过程。</p>
      </aside>
    );
  }

  return (
    <aside className="lm-agent-fleet-transcript" aria-label="办理过程" data-testid="lm-agent-fleet-transcript">
      <header className="lm-agent-fleet-transcript-head">
        <h3>{payload?.title ?? "办理过程"}</h3>
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onClose}>
          关闭
        </button>
      </header>
      {loading ? <p className="lm-meta">加载中…</p> : null}
      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      {payload?.executionState ? (
        <details className="lm-agent-fleet-transcript-advanced">
          <summary className="lm-meta">技术步骤（一般无需查看）</summary>
          <LawmindChatExecutionTrace executionState={payload.executionState} mode="timeline" compact />
        </details>
      ) : null}
      {(payload?.pendingRequiresAction?.length ?? 0) > 0 ? (
        <div className="lm-agent-fleet-transcript-pending">
          <div className="lm-meta">待处理 {payload?.pendingRequiresAction?.length} 项</div>
        </div>
      ) : null}
      <ul className="lm-agent-fleet-transcript-messages">
        {(payload?.messages ?? []).map((m, i) => (
          <li key={`${m.role}-${i}`} className={`lm-agent-fleet-msg lm-agent-fleet-msg-${m.role}`}>
            <span className="lm-agent-fleet-msg-role">{m.role === "user" ? "我" : "助手"}</span>
            <p>
              {m.content.slice(0, 600)}
              {m.content.length > 600 ? "…" : ""}
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
