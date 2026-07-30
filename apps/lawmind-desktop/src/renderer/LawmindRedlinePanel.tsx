import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson } from "./api-client";
import { apiPostRedlineHunkResolve, apiPostRedlineResolveAll } from "./lawmind-api-routes.ts";

type RedlineHunk = {
  hunkId: string;
  sectionIndex: number;
  sectionHeading?: string;
  before: string;
  after: string;
  status: "pending" | "accepted" | "rejected";
};

type RedlineProposal = {
  taskId: string;
  hunks: RedlineHunk[];
};

type Props = {
  apiBase: string;
  taskId: string;
  onDraftUpdated?: () => void;
};

export function LawmindRedlinePanel(props: Props): ReactNode {
  const { apiBase, taskId, onDraftUpdated } = props;
  const [proposal, setProposal] = useState<RedlineProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiBase || !taskId) {
      return;
    }
    try {
      const j = await apiGetJson<{ ok?: boolean; proposal?: RedlineProposal | null }>(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}/redline`,
      );
      if (j.ok) {
        setProposal(j.proposal ?? null);
      }
    } catch {
      setProposal(null);
    }
  }, [apiBase, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setBaseline = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = (await apiSendJson(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}/redline/baseline`,
        "POST",
        {},
      )) as { ok?: boolean; proposal?: RedlineProposal };
      if (j.ok && j.proposal) {
        setProposal(j.proposal);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = (await apiSendJson(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}/redline/generate`,
        "POST",
        {},
      )) as { ok?: boolean; proposal?: RedlineProposal };
      if (j.ok && j.proposal) {
        setProposal(j.proposal);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveHunk = async (hunkId: string, decision: "accept" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const j = (await apiPostRedlineHunkResolve(apiBase, taskId, hunkId, {
        decision,
      })) as { ok?: boolean; proposal?: RedlineProposal };
      if (j.ok && j.proposal) {
        setProposal(j.proposal);
        onDraftUpdated?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveAll = async (decision: "accept" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const j = (await apiPostRedlineResolveAll(apiBase, taskId, { decision })) as {
        ok?: boolean;
        proposal?: RedlineProposal;
      };
      if (j.ok && j.proposal) {
        setProposal(j.proposal);
        onDraftUpdated?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = proposal?.hunks.filter((h) => h.status === "pending") ?? [];

  return (
    <div className="lm-review-redline-panel">
      <div className="lm-review-redline-header">
        <strong>修订提案</strong>
        <div className="lm-review-redline-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            disabled={busy}
            onClick={() => void setBaseline()}
          >
            {busy ? "…" : "将当前稿设为基准"}
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? "…" : "生成提案"}
          </button>
          {pending.length > 0 ? (
            <>
              <button
                type="button"
                className="lm-btn lm-btn-small"
                disabled={busy}
                data-testid="lm-redline-accept-all"
                onClick={() => void resolveAll("accept")}
              >
                全部接受
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                disabled={busy}
                data-testid="lm-redline-reject-all"
                onClick={() => void resolveAll("reject")}
              >
                全部拒绝
              </button>
            </>
          ) : null}
        </div>
      </div>
      <p className="lm-meta">
        助手改稿后会自动生成待决提案；「接受」写入、「拒绝」回滚到基准。亦可手动设基准后编辑再「生成提案」。
      </p>
      {error ? <p className="lm-meta lm-text-error">{error}</p> : null}
      {pending.length === 0 ? (
        <p className="lm-meta">
          暂无待处理修订段。若已修改正文，请先点「将当前稿设为基准」再编辑，或点「生成提案」刷新对比。
        </p>
      ) : (
        <ul className="lm-review-redline-list">
          {pending.map((h) => (
            <li key={h.hunkId} className="lm-review-redline-item">
              {h.sectionHeading ? (
                <div className="lm-meta">{h.sectionHeading}</div>
              ) : (
                <div className="lm-meta">第 {h.sectionIndex + 1} 节</div>
              )}
              <pre className="lm-diff-remove">{h.before || "（空）"}</pre>
              <pre className="lm-diff-add">{h.after || "（空）"}</pre>
              <div className="lm-review-redline-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-small"
                  disabled={busy}
                  onClick={() => void resolveHunk(h.hunkId, "accept")}
                >
                  接受
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-small"
                  disabled={busy}
                  onClick={() => void resolveHunk(h.hunkId, "reject")}
                >
                  拒绝
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
