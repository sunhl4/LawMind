import { useState, type ReactNode } from "react";
import type { ChatMsg } from "./lawmind-chat";
import { humanToolLabel } from "./lawmind-chat-trace";

type Props = {
  messages: ChatMsg[];
  sourceIndices: number[];
  defaultCollapsed?: boolean;
};

export function LawmindMsgToolGroup({
  messages,
  sourceIndices,
  defaultCollapsed = true,
}: Props): ReactNode {
  const [open, setOpen] = useState(!defaultCollapsed);
  const toolNames = messages.flatMap((m) => m.toolCallSequence ?? []);
  const labels = toolNames.map((name) => humanToolLabel(name));
  const summary =
    labels.length === 0
      ? `过程（${messages.length} 条）`
      : labels.length <= 3
        ? labels.join(" · ")
        : `${labels.slice(0, 2).join(" · ")} 等 ${labels.length} 步`;

  return (
    <div className="lm-msg-tool-group" data-testid="lm-msg-tool-group">
      <button
        type="button"
        className="lm-msg-tool-group-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "收起过程" : "展开过程"} · {summary}
      </button>
      {open ? (
        <ul className="lm-msg-tool-group-list">
          {labels.map((label, i) => (
            <li key={`${sourceIndices[0] ?? 0}-tool-${i}`}>{label}</li>
          ))}
        </ul>
      ) : (
        <div className="lm-chat-thought-chips" aria-hidden>
          {labels.slice(0, 6).map((label, i) => (
            <span key={`${sourceIndices[0] ?? 0}-chip-${i}`} className="lm-chat-thought-chip">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
