import type { ReactNode } from "react";

export function LawmindSideExplorerSkeleton(): ReactNode {
  return (
    <div className="lm-side-explorer-skeleton" aria-hidden="true">
      <div className="lm-side-explorer-skeleton-line lm-side-explorer-skeleton-line--short" />
      <div className="lm-side-explorer-skeleton-line" />
      <div className="lm-side-explorer-skeleton-line" />
      <div className="lm-side-explorer-skeleton-line lm-side-explorer-skeleton-line--medium" />
      <div className="lm-side-explorer-skeleton-line" />
      <div className="lm-side-explorer-skeleton-line lm-side-explorer-skeleton-line--short" />
    </div>
  );
}
