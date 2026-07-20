import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import { apiGetJson } from "./api-client";
import { shouldShowDraftStatusHint } from "./lawmind-draft-status-hint";
import { buildGateStatusSummary, listBlockingGateDecisions } from "./lawmind-gate-display";

type Props = {
  apiBase: string | undefined;
  linkedTaskId: string | null | undefined;
  assistantText: string;
  gateDecisions?: GateDecision[];
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
};

export function LawmindChatDraftStatusBar(props: Props): ReactNode {
  const { apiBase, linkedTaskId, assistantText, gateDecisions, onOpenReview } = props;
  const [reviewStatus, setReviewStatus] = useState<ArtifactDraft["reviewStatus"] | null>(null);
  const [fetchedGates, setFetchedGates] = useState<GateDecision[] | null>(null);

  useEffect(() => {
    const tid = linkedTaskId?.trim();
    if (!apiBase || !tid) {
      setReviewStatus(null);
      setFetchedGates(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          draft?: { reviewStatus?: ArtifactDraft["reviewStatus"] };
          gateDecisions?: GateDecision[];
        }>(apiBase, `/api/drafts/${encodeURIComponent(tid)}`);
        if (!cancelled) {
          setReviewStatus(j.draft?.reviewStatus ?? "pending");
          setFetchedGates(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
        }
      } catch {
        if (!cancelled) {
          setReviewStatus("pending");
          setFetchedGates(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, linkedTaskId]);

  const effectiveGates = gateDecisions?.length ? gateDecisions : (fetchedGates ?? undefined);
  const gateSummary = buildGateStatusSummary(effectiveGates);
  const blockingCount = listBlockingGateDecisions(effectiveGates).length;

  if (gateSummary) {
    return (
      <div className="lm-callout lm-callout-warn lm-draft-status-hint" role="status">
        <p className="lm-callout-body">{gateSummary}</p>
        {onOpenReview ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            onClick={() =>
              onOpenReview({ taskId: linkedTaskId?.trim() || undefined })
            }
          >
            进入文书台
          </button>
        ) : null}
      </div>
    );
  }

  const hint = shouldShowDraftStatusHint({
    role: "assistant",
    linkedTaskId,
    reviewStatus,
    assistantText,
    gateBlockingCount: blockingCount,
  });
  if (!hint.show) {
    return null;
  }

  return (
    <div
      className={`lm-callout lm-callout-warn lm-draft-status-hint${hint.heuristic ? " lm-draft-status-hint-heuristic" : ""}`}
      role="status"
    >
      <p className="lm-callout-body">{hint.message}</p>
      {onOpenReview ? (
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          onClick={() =>
            onOpenReview({ taskId: linkedTaskId?.trim() || undefined })
          }
        >
          进入文书台
        </button>
      ) : null}
    </div>
  );
}
