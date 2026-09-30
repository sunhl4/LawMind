import { useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "./api-client";
import { openDeliverableInWps } from "./canvas/host-actions";
import { confirmDialog } from "./lawmind-confirm-dialog";
import { notifyOutboundChanged, type DeskOutboundItem } from "./lawmind-desk-outbound";
import { resumeChatAction } from "./lawmind-requires-action";

type Props = {
  apiBase: string;
  items: DeskOutboundItem[];
  onChanged: () => void;
};

/** 本案还没发出去的信。没有则不占一块空表。 */
export function LawmindDeskOutboundList(props: Props): ReactNode {
  const { apiBase, items, onChanged } = props;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) {
    return null;
  }

  const run = async (item: DeskOutboundItem, action: "approve" | "reject") => {
    if (busyId) {
      return;
    }
    if (action === "reject") {
      const ok = await confirmDialog({
        title: "驳回这封待发信？",
        body: "不会发出。",
        confirmLabel: "驳回",
        tone: "danger",
      });
      if (!ok) {
        return;
      }
    }
    setBusyId(item.id);
    setError(null);
    try {
      if (item.source === "inbox") {
        const sent = await apiSendJson<
          { ok?: boolean; remote?: { ok?: boolean; hint?: string; error?: string } },
          { action: "approve_send" | "dismiss" }
        >(apiBase, `/api/automations/inbox/${encodeURIComponent(item.id)}/action`, "POST", {
          action: action === "approve" ? "approve_send" : "dismiss",
        });
        if (action === "approve" && sent.remote && sent.remote.ok === false) {
          const hint = sent.remote.hint?.trim() || sent.remote.error?.trim();
          setError(hint ? `已批准，但没有从邮箱发出：${hint}` : "已批准，但没有从邮箱发出。");
        }
      } else if (item.sessionId) {
        await resumeChatAction(apiBase, {
          sessionId: item.sessionId,
          actionId: item.id,
          decision: action === "approve" ? "approve" : "reject",
        });
      }
      onChanged();
      notifyOutboundChanged();
    } catch (err) {
      setError(errorMessage(err, action === "approve" ? "批准发送失败" : "驳回失败"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="待发出" data-testid="lm-desk-outbound">
      <h3>待发出</h3>
      {error ? (
        <p className="lm-meta" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="lm-lawyer-deadline-list">
        {items.map((item) => (
          <li key={`${item.source}:${item.id}`} className="lm-lawyer-deadline-row">
            <span className="lm-lawyer-deadline-copy">
              <strong>{item.title}</strong>
              <span className="lm-lawyer-today-meta">
                {[item.to, item.subject].filter(Boolean).join(" · ") || "待发出"}
              </span>
              {item.attachments.length > 0 ? (
                <span className="lm-lawyer-inline-actions">
                  {item.attachments.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={() => {
                        void openDeliverableInWps(path).then((result) => {
                          if (!result.ok && result.error) {
                            setError(result.error);
                          }
                        });
                      }}
                    >
                      {path.split("/").pop() || path}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="lm-lawyer-inline-actions">
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                data-testid="lm-desk-outbound-approve"
                disabled={busyId !== null}
                onClick={() => void run(item, "approve")}
              >
                批准发送
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={busyId !== null}
                onClick={() => void run(item, "reject")}
              >
                驳回
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
