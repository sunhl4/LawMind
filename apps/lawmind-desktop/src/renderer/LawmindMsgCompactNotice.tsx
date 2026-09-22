import type { ReactNode } from "react";

type Props = {
  label?: string;
};

export function LawmindMsgCompactNotice({
  label = "较早对话已压缩，仅保留案件摘要与最近轮次。",
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
