import type { ReactNode } from "react";
import type { ActionSummaryPayload } from "./lawmind-requires-action";

export type ReviewOpenTarget = {
  taskId?: string;
  matterId?: string;
};

type Props = {
  actionSummary: ActionSummaryPayload | null | undefined;
  onOpenReview: (target?: ReviewOpenTarget) => void;
};

/**
 * Persistent chat CTA when drafts await sign-off. Prefers named drafts from
 * action-summary (not count-only) so lawyers can jump to a specific 文书台 item.
 */
export function LawmindChatReviewSticky(props: Props): ReactNode {
  const drafts = props.actionSummary?.pendingReviewDrafts ?? [];
  const count = props.actionSummary?.pendingReviewCount ?? drafts.length;
  if (count <= 0 && drafts.length === 0) {
    return null;
  }

  const primary = drafts[0];
  const extra = Math.max(0, (count || drafts.length) - (primary ? 1 : 0));
  const label = primary?.title?.trim()
    ? primary.title.trim()
    : count === 1
      ? "1 份待审文书"
      : `${count} 份待审文书`;

  return (
    <div className="lm-chat-review-sticky" role="status" data-testid="lm-chat-review-sticky">
      <div className="lm-chat-review-sticky-copy">
        <span>
          {primary?.title?.trim()
            ? `待审：${label}${extra > 0 ? `（另有 ${extra} 份）` : ""}`
            : `有 ${count} 份待审文书`}
          ，可进入文书台核验来源并签批。
        </span>
        {drafts.length > 1 ? (
          <ul className="lm-chat-review-sticky-list" aria-label="待审文书列表">
            {drafts.slice(0, 3).map((d) => (
              <li key={d.taskId}>
                <button
                  type="button"
                  className="lm-link-btn"
                  data-testid={`lm-chat-review-draft-${d.taskId}`}
                  onClick={() =>
                    props.onOpenReview({ taskId: d.taskId, matterId: d.matterId })
                  }
                >
                  {d.title?.trim() || d.taskId}
                  {d.reviewStatus === "modified" ? "（已修订）" : ""}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        className="lm-btn lm-btn-sm"
        data-testid="lm-chat-review-sticky-open"
        onClick={() =>
          props.onOpenReview(
            primary ? { taskId: primary.taskId, matterId: primary.matterId } : undefined,
          )
        }
      >
        {primary?.title?.trim() ? "打开此稿" : "进入文书台"}
      </button>
    </div>
  );
}
