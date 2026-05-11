/**
 * <MatterCockpit /> — W11 视图组件 1/6（概览）。
 *
 * 设计目标：未来 MatterWorkbench 缩减为 tab 容器后，将由本组件承担
 * "案件概览页"的渲染。当前作为 seam 已就位；MatterWorkbench 的相关代码
 * 会在后续 PR 渐进迁入这里。
 *
 * Props 仅承载摘要级数据（标题、状态、最近一次律师动作），不接 hot path 计算。
 */

import type { ReactNode } from "react";

type Props = {
  matterId: string;
  title: string;
  status: string;
  lastInteractionAt?: string;
  children?: ReactNode;
};

export function MatterCockpit({
  matterId,
  title,
  status,
  lastInteractionAt,
  children,
}: Props): ReactNode {
  return (
    <section
      className="lm-matter-cockpit"
      data-testid="lm-matter-cockpit"
      data-matter-id={matterId}
    >
      <header className="lm-matter-cockpit-header">
        <h2 className="lm-matter-cockpit-title">{title}</h2>
        <div className="lm-meta">
          状态 {status}
          {lastInteractionAt ? ` · 最近律师动作 ${lastInteractionAt}` : ""}
        </div>
      </header>
      <div className="lm-matter-cockpit-body">{children}</div>
    </section>
  );
}

export default MatterCockpit;
