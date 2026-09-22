/**
 * Catch render throws so the whole Electron window does not go blank.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Optional label for recovery copy (e.g. 工作台). */
  label?: string;
  onReset?: () => void;
};

type State = {
  error: Error | null;
};

export class LawmindErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[LawMind] renderer error boundary", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const where = this.props.label?.trim() || "界面";
    return (
      <div
        className="lm-error-boundary"
        role="alert"
        data-testid="lm-error-boundary"
        style={{
          padding: "24px",
          maxWidth: "36rem",
          margin: "40px auto",
          fontFamily: "system-ui, sans-serif",
          color: "#1a1a1a",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: "18px" }}>{where}出了问题</h2>
        <p style={{ margin: "0 0 16px", color: "#555", lineHeight: 1.5 }}>
          不必关应用。可先重试本页；若仍空白，点重新加载。
        </p>
        <pre
          style={{
            margin: "0 0 16px",
            padding: "12px",
            background: "#f5f5f5",
            borderRadius: "6px",
            fontSize: "12px",
            overflow: "auto",
            maxHeight: "8rem",
          }}
        >
          {this.state.error.message}
        </pre>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="lm-btn lm-btn-primary" onClick={this.reset}>
            重试
          </button>
          <button type="button" className="lm-btn lm-btn-ghost" onClick={this.reload}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
