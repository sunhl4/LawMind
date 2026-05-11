/**
 * <InteractionConvergence /> — W10。
 *
 * 渲染来自 src/lawmind/insights/computeConvergenceHints 的纯结果。
 * 不再在组件内进行业务计算。MatterWorkbench 在 W11 拆分时只需透传 hints 数组。
 */

import type { ReactNode } from "react";
import type { ConvergenceHint } from "../../../../../src/lawmind/insights/index.ts";

type Props = {
  hints: ConvergenceHint[];
};

const TONE_CLASS: Record<ConvergenceHint["tone"], string> = {
  warn: "lm-callout lm-callout-danger",
  info: "lm-callout",
  success: "lm-callout lm-callout-success",
  neutral: "lm-callout lm-callout-muted",
};

export function InteractionConvergence({ hints }: Props): ReactNode {
  if (hints.length === 0) {
    return (
      <div className="lm-callout lm-callout-muted">
        当前案件律师动作不足以触发收敛建议；继续使用即可形成产品信号。
      </div>
    );
  }
  return (
    <div className="lm-insights-convergence">
      {hints.map((h) => (
        <div key={h.key} className={TONE_CLASS[h.tone]} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{h.title}</div>
          <div className="lm-meta">{h.detail}</div>
          <div className="lm-meta" style={{ marginTop: 4 }}>
            建议动作：{h.actionLabel}
          </div>
        </div>
      ))}
    </div>
  );
}
