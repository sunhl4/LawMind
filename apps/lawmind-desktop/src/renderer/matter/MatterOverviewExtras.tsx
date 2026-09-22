import type { ReactNode } from "react";

type Props = {
  expanded: boolean;
  onExpand: () => void;
  /** 展开后允许收起（可选；缺省只进不退）。 */
  onCollapse?: () => void;
  expandLabel?: string;
  collapseLabel?: string;
  children: ReactNode;
};

/** Collapses secondary cards (default compact). */
export function MatterOverviewExtras(props: Props): ReactNode {
  const {
    expanded,
    onExpand,
    onCollapse,
    expandLabel = "更多洞察…",
    collapseLabel = "收起洞察",
    children,
  } = props;
  if (!expanded) {
    return (
      <div className="lm-matter-overview-more-toggle">
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-matter-overview-more"
          onClick={() => onExpand()}
        >
          {expandLabel}
        </button>
      </div>
    );
  }
  return (
    <div className="lm-matter-overview-extras" data-testid="lm-matter-overview-extras">
      {onCollapse ? (
        <div className="lm-matter-overview-more-toggle">
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-matter-overview-more"
            onClick={() => onCollapse()}
          >
            {collapseLabel}
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
