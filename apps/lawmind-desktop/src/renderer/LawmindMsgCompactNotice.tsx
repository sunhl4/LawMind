import type { ReactNode } from "react";

type Props = {
  label?: string;
};

export function LawmindMsgCompactNotice({
  label = "较早的来回已收成要点，最近的对话还在。",
}: Props): ReactNode {
  return (
    <div className="lm-msg-compact-notice" role="status" data-testid="lm-msg-compact-notice">
      <span className="lm-msg-compact-notice-icon" aria-hidden>
        …
      </span>
      <span>{label}</span>
    </div>
  );
}
