import type { ReactNode } from "react";

type Props = {
  expanded: boolean;
  onExpand: () => void;
  /** 展开后允许收起（可选；缺省只进不退）。 */
  onCollapse?: () => void;
  children: ReactNode;
};

/** Collapses cognition / insights cards in matter overview (default compact). */
export function MatterOverviewExtras(props: Props): ReactNode {
  const { expanded, onExpand, onCollapse, children } = props;
  if (!expanded) {
    return (
      <div className="lm-matter-overview-more-toggle">
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => onExpand()}>
          更多洞察…
        </button>
      </div>
    );
  }
  return (
    <div className="lm-matter-overview-extras">
      {onCollapse ? (
        <div className="lm-matter-overview-more-toggle">
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => onCollapse()}>
            收起洞察
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
