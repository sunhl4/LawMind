import type { ReactNode } from "react";

/** Header badge: opens「在办」with needs-decision focus (not a modal). */
export function LawmindNeedsDecisionButton(props: {
  total: number;
  onClick: () => void;
}): ReactNode {
  const { total, onClick } = props;
  if (total <= 0) {
    return null;
  }
  return (
    <button
      type="button"
      className="lm-btn lm-btn-secondary lm-btn-sm lm-needs-decision-trigger"
      data-testid="lm-header-needs-decision"
      onClick={onClick}
      title="打开「在办」待我拍板：澄清、批准、待审文书与案件审批"
    >
      待我拍板 ({total})
    </button>
  );
}
