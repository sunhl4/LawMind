/**
 * <InteractionConvergence /> — W10。
 *
 * 渲染来自 src/lawmind/insights/computeConvergenceHints 的纯结果。
 * 可选 onAction：Matter 概览等场景可挂「打开入口」按钮。
 */

import type { ReactNode } from "react";
import type { ConvergenceHint } from "../../../../../src/lawmind/insights/index.ts";

type Props = {
  hints: ConvergenceHint[];
  onAction?: (hint: ConvergenceHint) => void;
  /** When false, hide action buttons even if onAction is set. Default true. */
  showActions?: boolean;
};

const TONE_CLASS: Record<ConvergenceHint["tone"], string> = {
  warn: "lm-callout lm-callout-danger",
  info: "lm-callout",
  success: "lm-callout lm-callout-success",
  neutral: "lm-callout lm-callout-muted",
};

export function InteractionConvergence({
  hints,
  onAction,
  showActions = true,
}: Props): ReactNode {
  if (hints.length === 0) {
    return (
      <div className="lm-callout lm-callout-muted">
        样本不足。
      </div>
    );
  }
  return (
    <div className="lm-insights-convergence">
      {hints.map((h) => (
        <div key={h.key} className={`${TONE_CLASS[h.tone]} lm-matter-ops-list-item`} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{h.title}</div>
          <div className="lm-meta">{h.detail}</div>
          {showActions && onAction ? (
            <div className="lm-matter-ops-actions lm-matter-convergence-actions" style={{ marginTop: 6 }}>
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onAction(h)}>
                {h.actionLabel}
              </button>
            </div>
          ) : (
            <div className="lm-meta" style={{ marginTop: 4 }}>
              建议动作：{h.actionLabel}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
