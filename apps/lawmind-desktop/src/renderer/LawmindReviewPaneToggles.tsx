import type { ReactElement } from "react";
import type { ReviewPaneId, ReviewPaneVisibility } from "./lawmind-review-pane-prefs";

type PaneSpec = {
  id: ReviewPaneId;
  label: string;
  titleShow: string;
  titleHide: string;
};

const REVIEW_PANE_SPECS: PaneSpec[] = [
  { id: "meta", label: "签批", titleShow: "显示签批区", titleHide: "隐藏签批区" },
  { id: "editor", label: "编辑", titleShow: "显示文档编辑区", titleHide: "隐藏文档编辑区" },
  { id: "preview", label: "预览", titleShow: "显示交付预览", titleHide: "隐藏交付预览" },
];

type Props = {
  visibility: ReviewPaneVisibility;
  onToggle: (id: ReviewPaneId) => void;
  className?: string;
  /** Cursor 式图标分栏开关，不显示文字标签 */
  iconOnly?: boolean;
};

function paneIcon(id: ReviewPaneId): ReactElement {
  switch (id) {
    case "meta":
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="2" width="12" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 8.5 7 10.5 11 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "editor":
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="2" width="11" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    case "preview":
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 6h12" stroke="currentColor" strokeWidth="1.1" />
          <rect x="4" y="8" width="5" height="1.2" rx="0.4" fill="currentColor" opacity="0.5" />
          <rect x="4" y="10" width="7" height="1.2" rx="0.4" fill="currentColor" opacity="0.35" />
        </svg>
      );
  }
}

export function LawmindReviewPaneToggles(props: Props) {
  const { visibility, onToggle, className, iconOnly = false } = props;
  const rootClass = [
    "lm-panel-toggles",
    "lm-review-pane-toggles",
    iconOnly ? "lm-review-pane-toggles-icons" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} role="toolbar" aria-label="文书台分栏">
      {REVIEW_PANE_SPECS.map((pane) => {
        const visible = visibility[pane.id];
        return (
          <button
            key={pane.id}
            type="button"
            className={`lm-panel-toggle ${!visible ? "lm-panel-toggle-off" : ""}`}
            aria-pressed={visible}
            aria-label={pane.label}
            title={visible ? pane.titleHide : pane.titleShow}
            onClick={() => onToggle(pane.id)}
          >
            <span className="lm-panel-toggle-icon">{paneIcon(pane.id)}</span>
            {iconOnly ? null : <span className="lm-panel-toggle-label">{pane.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
