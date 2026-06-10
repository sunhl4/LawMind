import React from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { ReviewWorkbench } from "../ReviewWorkbench";
import type { ReviewPaneId } from "../lawmind-review-pane-prefs";

export type ReviewViewProps = {
  apiBase: string;
  assistantId: string;
  initialTaskId: string | null;
  initialMatterId: string | null;
  initialStatusFilter: ArtifactDraft["reviewStatus"] | "all";
  initialListMode: "pending" | "all";
  externalRefreshToken: number;
  returnMatterId: string | null;
  paneVisibility: Record<ReviewPaneId, boolean>;
  onReturnToMatter: () => void;
  onShowArtifact: (relPath: string) => void;
  onRecordsChanged: () => void;
  onGoToChat: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  onRevisionJobQueued: (opts: {
    sessionId: string;
    assistantId: string;
    taskId: string;
  }) => void;
  onToggleReviewPane: (id: ReviewPaneId) => void;
};

function ReviewViewImpl(props: ReviewViewProps) {
  return (
    <div className="lm-main-workbench">
      <ReviewWorkbench
        apiBase={props.apiBase}
        assistantId={props.assistantId}
        initialTaskId={props.initialTaskId}
        initialMatterId={props.initialMatterId}
        initialStatusFilter={props.initialStatusFilter}
        initialListMode={props.initialListMode}
        externalRefreshToken={props.externalRefreshToken}
        returnMatterId={props.returnMatterId}
        onReturnToMatter={props.onReturnToMatter}
        onShowArtifact={props.onShowArtifact}
        onRecordsChanged={props.onRecordsChanged}
        onGoToChat={props.onGoToChat}
        onRevisionJobQueued={props.onRevisionJobQueued}
        paneVisibility={props.paneVisibility}
        _onToggleReviewPane={props.onToggleReviewPane}
      />
    </div>
  );
}

export const ReviewView = React.memo(ReviewViewImpl);
