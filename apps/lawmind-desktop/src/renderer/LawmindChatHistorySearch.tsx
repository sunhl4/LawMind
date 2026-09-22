import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RenderableChatItem } from "./lawmind-message-preprocess";

type Props = {
  items: RenderableChatItem[];
  onHighlightIndices: (indices: Set<number> | null) => void;
};

export function LawmindChatHistorySearch({ items, onHighlightIndices }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matchIndices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return null;
    }
    const set = new Set<number>();
    for (const item of items) {
      if (item.kind === "message") {
        if ((item.message.text ?? "").toLowerCase().includes(q)) {
          set.add(item.sourceIndex);
        }
      } else if (item.kind === "tool_group") {
        for (const m of item.messages) {
          if ((m.text ?? "").toLowerCase().includes(q)) {
            for (const si of item.sourceIndices) {
              set.add(si);
            }
          }
        }
      }
    }
    return set;
  }, [items, query]);

  useEffect(() => {
    onHighlightIndices(matchIndices);
  }, [matchIndices, onHighlightIndices]);

  if (!open) {
    return null;
  }

  return (
    <div className="lm-chat-history-search" role="search">
      <input
        type="search"
        className="lm-input lm-chat-history-search-input"
        placeholder="搜索本对话（⌘F）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="搜索对话内容"
      />
      <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={() => setOpen(false)}>
        关闭
      </button>
      {query.trim() ? (
        <span className="lm-meta">
          {matchIndices?.size ?? 0} 条匹配
        </span>
      ) : null}
    </div>
  );
}
