import type { ReactNode } from "react";

type Props = {
  pendingApprovalCount: number;
  clarificationPending: boolean;
  clarificationCount: number;
  onOpenActionHub?: () => void;
  onScrollToClarify?: () => void;
};

export function LawmindRequiresActionStrip(props: Props): ReactNode {
  const {
    pendingApprovalCount,
    clarificationPending,
    clarificationCount,
    onOpenActionHub,
    onScrollToClarify,
  } = props;

  const total = pendingApprovalCount + (clarificationPending ? Math.max(clarificationCount, 1) : 0);
  if (total <= 0) {
    return null;
  }

  const parts: string[] = [];
  if (pendingApprovalCount > 0) {
    parts.push(`${pendingApprovalCount} 项待批准`);
  }
  if (clarificationPending) {
    parts.push(
      clarificationCount > 0
        ? `${clarificationCount} 项待澄清`
        : "有待澄清事项",
    );
  }

  const handleClick = () => {
    if (clarificationPending && onScrollToClarify) {
      onScrollToClarify();
      return;
    }
    onOpenActionHub?.();
  };

  return (
    <div className="lm-requires-action-strip" role="status">
      <span className="lm-requires-action-strip-text">需要您处理：{parts.join(" · ")}</span>
      <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={handleClick}>
        {clarificationPending ? "去填写" : "打开待办"}
      </button>
    </div>
  );
}
