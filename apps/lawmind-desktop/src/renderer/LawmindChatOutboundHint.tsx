import { useEffect, useState, type ReactNode } from "react";
import {
  LAWMIND_OUTBOUND_CHANGED,
  pendingOutboundItems,
  requestOpenMatterOutbound,
} from "./lawmind-desk-outbound";
import { loadActionSummary } from "./lawmind-requires-action";

/** 当前案子还有没发出的信时，对话里留一句，点进工作台文书。 */
export function LawmindChatOutboundHint(props: {
  apiBase?: string;
  matterId?: string | null;
}): ReactNode {
  const { apiBase, matterId } = props;
  const [count, setCount] = useState(0);
  const mid = matterId?.trim() ?? "";

  useEffect(() => {
    if (!apiBase?.trim() || !mid) {
      setCount(0);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      void loadActionSummary(apiBase, mid)
        .then((summary) => {
          if (!cancelled) {
            setCount(pendingOutboundItems(summary).filter((item) => item.matterId === mid).length);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCount(0);
          }
        });
    };
    load();
    const onChanged = () => load();
    window.addEventListener(LAWMIND_OUTBOUND_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(LAWMIND_OUTBOUND_CHANGED, onChanged);
    };
  }, [apiBase, mid]);

  if (count === 0) {
    return null;
  }
  return (
    <button
      type="button"
      className="lm-btn lm-btn-ghost lm-btn-sm"
      data-testid="lm-chat-outbound-hint"
      onClick={() => requestOpenMatterOutbound(mid)}
    >
      本案有待发出
    </button>
  );
}
