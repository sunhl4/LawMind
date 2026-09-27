import { useEffect, useState, type ReactNode } from "react";
import { ASSISTANT_PRESENCE_LABEL, type AssistantPresence } from "../../../../src/lawmind/assistants/presence.ts";
import { apiGetJson } from "./api-client";

type Desk = {
  displayName: string;
  presence: AssistantPresence;
  presenceDetail?: string;
  responsibility?: string;
  prohibitions?: string;
  standing: Array<{ title: string; lastResult?: string }>;
  visible: boolean;
};

/**
 * 对话里的助手席：一行说明这位助手是谁、卡在哪、你不在时最后做成了什么。
 * 没有职务、没有常设工作、也闲着时不出现，空对话仍是「直接说要办的事」。
 */
export function LawmindAssistantDesk(props: {
  apiBase?: string;
  assistantId: string;
}): ReactNode {
  const { apiBase, assistantId } = props;
  const [desk, setDesk] = useState<Desk | null>(null);

  useEffect(() => {
    if (!apiBase?.trim() || !assistantId) {
      setDesk(null);
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ desk?: Desk }>(
      apiBase,
      `/api/assistants/${encodeURIComponent(assistantId)}/desk`,
    )
      .then((payload) => {
        if (!cancelled) {
          setDesk(payload.desk?.visible ? payload.desk : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesk(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, assistantId]);

  if (!desk) {
    return null;
  }
  const label = ASSISTANT_PRESENCE_LABEL[desk.presence] ?? "空闲";
  const away = desk.standing.find((item) => item.lastResult) ?? desk.standing[0];
  return (
    <div className="lm-assistant-desk" data-testid="lm-assistant-desk">
      <span className={`lm-presence-dot lm-presence-dot--${desk.presence}`} aria-hidden />
      <p className="lm-assistant-desk__line">
        <strong>{desk.displayName}</strong>
        {` · ${label}`}
        {desk.presenceDetail ? ` · ${desk.presenceDetail}` : ""}
        {desk.responsibility ? ` · ${desk.responsibility}` : ""}
        {desk.prohibitions ? ` · 必须先问你：${desk.prohibitions}` : ""}
      </p>
      {away ? (
        <p className="lm-assistant-desk__away">
          你不在时：{away.title}
          {away.lastResult ? `。${away.lastResult}` : "。还没有跑过。"}
        </p>
      ) : null}
    </div>
  );
}
