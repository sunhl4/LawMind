/**
 * <ProductExperiments /> — W10。
 *
 * 渲染 src/lawmind/insights/computeProductExperiments 的纯结果。
 */

import type { ReactNode } from "react";
import type { ProductExperimentItem } from "../../../../../src/lawmind/insights/index.ts";

type Props = {
  items: ProductExperimentItem[];
};

const PRIORITY_BADGE: Record<ProductExperimentItem["priority"], string> = {
  high: "lm-badge lm-badge-blocker",
  medium: "lm-badge lm-badge-warning",
  low: "lm-badge",
};

export function ProductExperiments({ items }: Props): ReactNode {
  if (items.length === 0) {
    return (
      <div className="lm-callout lm-callout-muted">
        当前信号不足以推导产品实验候选；持续使用即可形成积累。
      </div>
    );
  }
  return (
    <div className="lm-insights-experiments">
      {items.map((it) => (
        <div key={it.key} className="lm-callout" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>{it.title}</strong>
            <span className={PRIORITY_BADGE[it.priority]}>{labelForPriority(it.priority)}</span>
          </div>
          <div className="lm-meta">假设：{it.hypothesis}</div>
          <div className="lm-meta">验证：{it.validation}</div>
          <div className="lm-meta">信号：{it.signal}</div>
        </div>
      ))}
    </div>
  );
}

function labelForPriority(p: ProductExperimentItem["priority"]): string {
  if (p === "high") {return "高优";}
  if (p === "medium") {return "中优";}
  return "观察";
}
