import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { DraftScaffoldView } from "../../../../src/lawmind/deliverables/scaffold-status.ts";
import { scaffoldReviewBannerText } from "./lawmind-scaffold-copy";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import { apiGetJson } from "./api-client";
import { shouldShowDraftStatusHint } from "./lawmind-draft-status-hint";
import { buildGateStatusSummary, listBlockingGateDecisions } from "./lawmind-gate-display";
import { openDeliverableInWps } from "./canvas/host-actions";
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";

type Props = {
  apiBase: string | undefined;
  linkedTaskId: string | null | undefined;
  assistantText: string;
  gateDecisions?: GateDecision[];
  workspaceDir?: string;
  /** 保留兼容：不再跳到审稿页。 */
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
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
  } = props;
  const [reviewStatus, setReviewStatus] = useState<ArtifactDraft["reviewStatus"] | null>(null);
  const [fetchedGates, setFetchedGates] = useState<GateDecision[] | null>(null);
  const [outputPath, setOutputPath] = useState<string | undefined>(undefined);
  const [scaffold, setScaffold] = useState<DraftScaffoldView | null>(null);
  useEffect(() => {
    const tid = linkedTaskId?.trim();
    if (!apiBase || !tid) {
      setReviewStatus(null);
      setFetchedGates(null);
      setOutputPath(undefined);
      setScaffold(null);
      return undefined;
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
          setFetchedGates(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
          setOutputPath(j.draft?.outputPath?.trim() || undefined);
          setScaffold(j.scaffold ?? null);
        }
      } catch {
        if (!cancelled) {
          setReviewStatus("pending");
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
  const openArtifact = () => {
    if (!outputPath) {
      return;
    }
    const rel =
      workspaceDir && workspaceDir.trim()
        ? toWorkspaceRelativePath(workspaceDir, outputPath)
        : outputPath.replace(/^.*[/\\](artifacts[/\\].+)$/i, "$1");
    if (rel) {
      void openDeliverableInWps(rel.replace(/\\/g, "/"));
    }
  };

  const actions = outputPath ? (
    <div className="lm-draft-status-actions">
      <button
        type="button"
        className="lm-btn lm-btn-sm"
        data-testid="lm-draft-status-open-artifact"
        onClick={openArtifact}
      >
        用 WPS 打开
      </button>
    </div>
  ) : null;

  if (scaffold?.dense) {
    return (
      <div
        className="lm-callout lm-callout-warn lm-draft-status-hint"
        role="status"
        data-testid="lm-draft-status-scaffold"
      >
        <p className="lm-callout-body">{scaffoldReviewBannerText(scaffold)}</p>
        {actions}
      </div>
    );
  }

  if (gateSummary) {
    return (
      <div className="lm-callout lm-callout-warn lm-draft-status-hint" role="status">
        <p className="lm-callout-body">{gateSummary}</p>
        {actions}
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
      {actions}
    </div>
  );
}
