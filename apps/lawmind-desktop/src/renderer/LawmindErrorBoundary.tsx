/**
 * Catch render throws so the whole Electron window does not go blank.
 * The dialog shows the thrown message plus the component stack and JS stack,
 * which is what we need to find the line. Case files are not attached.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { LawmindErrorReportDialog } from "./LawmindErrorReportDialog";
import { describeThrown, formatErrorCauseReport } from "./lawmind-error-report";

type Props = {
  children: ReactNode;
  /** Optional label for recovery copy (e.g. 工作台). */
  label?: string;
  onReset?: () => void;
};

type State = {
  error: Error | null;
  componentStack: string;
  copied: boolean;
  at: string;
};

export class LawmindErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "", copied: false, at: "" };

  static getDerivedStateFromError(error: Error): Pick<State, "error" | "componentStack" | "copied" | "at"> {
    return { error, componentStack: "", copied: false, at: new Date().toISOString() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[LawMind] renderer error boundary", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: "", copied: false, at: "" });
    this.props.onReset?.();
  };

  private reload = (): void => {
    window.location.reload();
  };

  private copy = (): void => {
    const error = this.state.error;
    if (!error) {
      return;
    }
    const where = this.props.label?.trim() || "界面";
    const described = describeThrown(error);
    const text = formatErrorCauseReport({
      where,
      ...described,
      componentStack: this.state.componentStack,
      at: this.state.at,
    });
    void navigator.clipboard?.writeText(text).then(
      () => this.setState({ copied: true }),
      () => this.setState({ copied: false }),
    );
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const where = this.props.label?.trim() || "界面";
    const described = describeThrown(this.state.error);
    return (
      <LawmindErrorReportDialog
        where={where}
        name={described.name}
        message={described.message}
        stack={described.stack}
        componentStack={this.state.componentStack}
        at={this.state.at}
        copied={this.state.copied}
        onCopy={this.copy}
        actions={
          <>
            <button type="button" className="lm-btn lm-btn-ghost" onClick={this.reset}>
              重试
            </button>
            <button type="button" className="lm-btn lm-btn-ghost" onClick={this.reload}>
              重新加载
            </button>
          </>
        }
      />
    );
  }
}
