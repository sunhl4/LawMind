import { useState, type ReactNode } from "react";
import type { ChatMsg } from "./lawmind-chat";

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
  const label =
    toolNames.length > 0
      ? `工具步骤（${toolNames.length} 次）`
      : `工具步骤（${messages.length} 条）`;

  return (
    <div className="lm-msg-tool-group" data-testid="lm-msg-tool-group">
      <button
        type="button"
        className="lm-msg-tool-group-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "收起" : "展开"} {label}
      </button>
      {open ? (
        <ul className="lm-msg-tool-group-list">
          {toolNames.map((name, i) => (
            <li key={`${sourceIndices[0] ?? 0}-tool-${i}`}>{name}</li>
          ))}
        </ul>
      ) : (
        <p className="lm-meta lm-msg-tool-group-summary">{label} 已折叠</p>
      )}
    </div>
  );
}
