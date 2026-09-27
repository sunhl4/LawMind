/**
 * Popup for errors React does not catch: event handlers and rejected promises.
 * Render crashes are handled by LawmindErrorBoundary, which already has the
 * component stack. This host keeps the first unexpected error on screen.
 */
import { useEffect, useState, type ReactNode } from "react";
import { LawmindErrorReportDialog } from "./LawmindErrorReportDialog";
import {
  describeThrown,
  formatErrorCauseReport,
  isIgnorableThrown,
  type ErrorCauseReport,
} from "./lawmind-error-report";

type OpenReport = ErrorCauseReport & { at: string };

export function LawmindUnexpectedErrorHost(): ReactNode {
  const [report, setReport] = useState<OpenReport | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const open = (error: unknown, where: string) => {
      if (error == null || error === "") {
        return;
      }
      const described = describeThrown(error);
      if (isIgnorableThrown(described)) {
        return;
      }
      if (described.message === "未知错误" && !described.stack) {
        return;
      }
      setReport((current) => current ?? { where, ...described, componentStack: "", at: new Date().toISOString() });
    };
    const onError = (event: ErrorEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const message = event.message?.trim() ?? "";
      open(event.error ?? (message ? message : undefined), "未捕获的异常");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      open(event.reason, "未处理的失败");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!report) {
    return null;
  }

  return (
    <LawmindErrorReportDialog
      {...report}
      copied={copied}
      onCopy={() => {
        void navigator.clipboard?.writeText(formatErrorCauseReport(report)).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      actions={
        <button
          type="button"
          className="lm-btn lm-btn-ghost"
          data-testid="lm-error-report-dismiss"
          onClick={() => {
            setReport(null);
            setCopied(false);
          }}
        >
          关闭
        </button>
      }
    />
  );
}
