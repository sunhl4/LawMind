import type { ReactNode } from "react";
import { formatErrorCauseReport, type ErrorCauseReport } from "./lawmind-error-report";

type Props = ErrorCauseReport & {
  copied: boolean;
  onCopy: () => void;
  actions?: ReactNode;
};

export function LawmindErrorReportDialog({
  where,
  name,
  message,
  stack,
  componentStack,
  at,
  copied,
  onCopy,
  actions,
}: Props): ReactNode {
  const text = formatErrorCauseReport({ where, name, message, stack, componentStack, at });
  return (
    <div className="lm-error-report-backdrop" role="presentation" data-testid="lm-error-boundary">
      <div
        className="lm-error-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lm-error-report-title"
        data-testid="lm-error-report-dialog"
      >
        <header className="lm-error-report-head">
          <h2 id="lm-error-report-title">{where}出了问题</h2>
          <p className="lm-error-report-lead">
            下面是具体原因和调用位置。复制后发给帮你看的人即可，没有案件内容。
          </p>
        </header>
        <pre className="lm-error-report-body lm-scroll" data-testid="lm-error-report-body">
          {text}
        </pre>
        <div className="lm-error-report-actions">
          <button type="button" className="lm-btn" data-testid="lm-error-report-copy" onClick={onCopy}>
            {copied ? "已复制" : "复制详情"}
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
