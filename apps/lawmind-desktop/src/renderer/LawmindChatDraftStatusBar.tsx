import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { DraftScaffoldView } from "../../../../src/lawmind/deliverables/index.ts";
import { scaffoldReviewBannerText } from "./lawmind-scaffold-copy";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import { apiGetJson } from "./api-client";
import { shouldShowDraftStatusHint } from "./lawmind-draft-status-hint";
import { buildGateStatusSummary, listBlockingGateDecisions } from "./lawmind-gate-display";
import { requestOpenWorkspaceFile } from "./lawmind-workspace-file-open";
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";
import { useRequireSignoffReview } from "./lawmind-review-prefs";

type Props = {
  apiBase: string | undefined;
  linkedTaskId: string | null | undefined;
  assistantText: string;
  gateDecisions?: GateDecision[];
  workspaceDir?: string;
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
  /** 主签批路径：跳转在办办理区 */
  onOpenNeedsDecisionDesk?: (target?: {
    taskId?: string;
    matterId?: string;
    preferStatus?: "awaiting_review";
  }) => void;
};

export function LawmindChatDraftStatusBar(props: Props): ReactNode {
  const {
    apiBase,
    linkedTaskId,
    assistantText,
    gateDecisions,
    workspaceDir,
    onOpenReview,
    onOpenNeedsDecisionDesk,
  } = props;
  const [reviewStatus, setReviewStatus] = useState<ArtifactDraft["reviewStatus"] | null>(null);
  const [matterId, setMatterId] = useState<string | undefined>(undefined);
  const [fetchedGates, setFetchedGates] = useState<GateDecision[] | null>(null);
  const [outputPath, setOutputPath] = useState<string | undefined>(undefined);
  const [scaffold, setScaffold] = useState<DraftScaffoldView | null>(null);
  const requireSignoffReview = useRequireSignoffReview();

  useEffect(() => {
    const tid = linkedTaskId?.trim();
    if (!apiBase || !tid) {
      setReviewStatus(null);
      setMatterId(undefined);
      setFetchedGates(null);
      setOutputPath(undefined);
      setScaffold(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          draft?: {
            reviewStatus?: ArtifactDraft["reviewStatus"];
            matterId?: string;
            outputPath?: string;
          };
          gateDecisions?: GateDecision[];
          scaffold?: DraftScaffoldView;
        }>(apiBase, `/api/drafts/${encodeURIComponent(tid)}`);
        if (!cancelled) {
          setReviewStatus(j.draft?.reviewStatus ?? "pending");
          setMatterId(j.draft?.matterId?.trim() || undefined);
          setFetchedGates(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
          setOutputPath(j.draft?.outputPath?.trim() || undefined);
          setScaffold(j.scaffold ?? null);
        }
      } catch {
        if (!cancelled) {
          setReviewStatus("pending");
          setMatterId(undefined);
          setFetchedGates(null);
          setOutputPath(undefined);
          setScaffold(null);
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
  const tid = linkedTaskId?.trim() || undefined;

  const openReview = () => onOpenReview?.({ taskId: tid, matterId });

  const openResult = () => {
    if (requireSignoffReview && onOpenNeedsDecisionDesk && tid) {
      onOpenNeedsDecisionDesk({
        taskId: tid,
        matterId,
        preferStatus: "awaiting_review",
      });
      return;
    }
    if (onOpenReview) {
      onOpenReview({ taskId: tid, matterId });
      return;
    }
    if (onOpenNeedsDecisionDesk && tid) {
      onOpenNeedsDecisionDesk({
        taskId: tid,
        matterId,
        preferStatus: "awaiting_review",
      });
    }
  };
  const pendingOrModified = reviewStatus === "pending" || reviewStatus === "modified";
  const primaryLabel = requireSignoffReview && pendingOrModified ? "去签批" : "打开结果";

  const openArtifact = () => {
    if (!outputPath) {
      return;
    }
    const rel =
      workspaceDir && workspaceDir.trim()
        ? toWorkspaceRelativePath(workspaceDir, outputPath)
        : outputPath.replace(/^.*[/\\](artifacts[/\\].+)$/i, "$1");
    if (rel) {
      requestOpenWorkspaceFile(rel.replace(/\\/g, "/"));
    }
  };

  const actions = (primaryLabel: string) => (
    <div className="lm-draft-status-actions">
      {(onOpenNeedsDecisionDesk || onOpenReview) && reviewStatus !== "approved" ? (
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-draft-status-signoff"
          onClick={openResult}
        >
          {primaryLabel}
        </button>
      ) : null}
      {reviewStatus === "approved" && onOpenReview ? (
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          data-testid="lm-draft-status-open-review"
          onClick={openReview}
        >
          看意见
        </button>
      ) : null}
      {reviewStatus === "approved" && outputPath ? (
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          data-testid="lm-draft-status-open-artifact"
          onClick={openArtifact}
        >
          打开交付物
        </button>
      ) : null}
    </div>
  );

  if (scaffold?.dense) {
    return (
      <div
        className="lm-callout lm-callout-warn lm-draft-status-hint"
        role="status"
        data-testid="lm-draft-status-scaffold"
      >
        <p className="lm-callout-body">{scaffoldReviewBannerText(scaffold)}</p>
        {actions("去改稿")}
      </div>
    );
  }

  if (gateSummary) {
    return (
      <div className="lm-callout lm-callout-warn lm-draft-status-hint" role="status">
        <p className="lm-callout-body">{gateSummary}</p>
        {actions(primaryLabel)}
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
      data-testid="lm-draft-status-ready"
    >
      <p className="lm-callout-body">{hint.message}</p>
      {actions(pendingOrModified ? primaryLabel : "改稿")}
    </div>
  );
}
