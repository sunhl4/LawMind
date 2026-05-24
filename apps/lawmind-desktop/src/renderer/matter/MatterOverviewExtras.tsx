import type { ReactNode } from "react";

type Props = {
  expanded: boolean;
  onExpand: () => void;
  children: ReactNode;
};

/** Collapses cognition / insights / experiment cards in matter overview (default compact). */
export function MatterOverviewExtras(props: Props): ReactNode {
  const { expanded, onExpand, children } = props;
  if (!expanded) {
    return (
      <div className="lm-matter-overview-more-toggle">
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => onExpand()}>
          更多洞察与实验…
        </button>
      </div>
    );
  }
  return <div className="lm-matter-overview-extras">{children}</div>;
}
