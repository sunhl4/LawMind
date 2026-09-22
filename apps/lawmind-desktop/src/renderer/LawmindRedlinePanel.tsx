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
  spanStart?: number;
  spanEnd?: number;
  granularity?: "surgical" | "section";
};

type RedlineProposal = {
  taskId: string;
  hunks: RedlineHunk[];
  baselineSections?: Array<{ heading: string; body: string }>;
};

/** 上下文字数：surgical hunk 在基线正文中的前后展示窗口。 */
const SURGICAL_CONTEXT_CHARS = 30;

/**
 * surgical hunk 的上下文内联渲染：从基线正文截取 span 前后各 N 字，
 * 只把实际改动的字/句放进 <mark>（而非整段 mark，避免误导审阅幅度）。
 */
function surgicalContextRows(
  h: RedlineHunk,
  baselineBody: string | undefined,
): { beforeRow: ReactNode; afterRow: ReactNode } | null {
  if (
    h.granularity !== "surgical" ||
    !baselineBody ||
    typeof h.spanStart !== "number" ||
    typeof h.spanEnd !== "number"
  ) {
    return null;
  }
  if (h.spanStart < 0 || h.spanEnd > baselineBody.length || h.spanEnd < h.spanStart) {
    return null;
  }
  const head = baselineBody.slice(
    Math.max(0, h.spanStart - SURGICAL_CONTEXT_CHARS),
    h.spanStart,
  );
  const tail = baselineBody.slice(
    h.spanEnd,
    Math.min(baselineBody.length, h.spanEnd + SURGICAL_CONTEXT_CHARS),
  );
  const prefix = h.spanStart - SURGICAL_CONTEXT_CHARS > 0 ? "…" : "";
  const suffix = h.spanEnd + SURGICAL_CONTEXT_CHARS < baselineBody.length ? "…" : "";
  return {
    beforeRow: (
      <>
        {prefix}
        {head}
        <mark className="lm-diff-span">{h.before || "（空）"}</mark>
        {tail}
        {suffix}
      </>
    ),
    afterRow: (
      <>
        {prefix}
        {head}
        <mark className="lm-diff-span">{h.after || "（空）"}</mark>
        {tail}
        {suffix}
      </>
    ),
  };
}

type Props = {
  apiBase: string;
  taskId: string;
  onDraftUpdated?: () => void;
  /** 改稿主区：无 hunk 时不占位。 */
  hideIfEmpty?: boolean;
};

export function LawmindRedlinePanel(props: Props): ReactNode {
  const { apiBase, taskId, onDraftUpdated, hideIfEmpty = false } = props;
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
  const resolved = proposal?.hunks.filter((h) => h.status !== "pending") ?? [];
  if (hideIfEmpty && pending.length === 0 && resolved.length === 0) {
    return null;
  }

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
      <p className="lm-meta">改稿后出提案。</p>
      {error ? <p className="lm-meta lm-text-danger">{error}</p> : null}
      {pending.length === 0 ? (
        <p className="lm-meta">暂无修订。</p>
      ) : (
        <ul className="lm-review-redline-list">
          {pending.map((h) => {
            const ctxRows = surgicalContextRows(
              h,
              proposal?.baselineSections?.[h.sectionIndex]?.body,
            );
            return (
            <li key={h.hunkId} className="lm-review-redline-item">
              {h.sectionHeading ? (
                <div className="lm-meta">
                  {h.sectionHeading}
                  {h.granularity === "surgical" ? " · 最小修改" : ""}
                </div>
              ) : (
                <div className="lm-meta">
                  第 {h.sectionIndex + 1} 节
                  {h.granularity === "surgical" ? " · 最小修改" : ""}
                </div>
              )}
              <pre className="lm-diff-remove">
                {ctxRows ? (
                  ctxRows.beforeRow
                ) : h.granularity === "surgical" ? (
                  <mark className="lm-diff-span">{h.before || "（空）"}</mark>
                ) : (
                  h.before || "（空）"
                )}
              </pre>
              <pre className="lm-diff-add">
                {ctxRows ? (
                  ctxRows.afterRow
                ) : h.granularity === "surgical" ? (
                  <mark className="lm-diff-span">{h.after || "（空）"}</mark>
                ) : (
                  h.after || "（空）"
                )}
              </pre>
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
            );
          })}
        </ul>
      )}
      {resolved.length > 0 ? (
        <details className="lm-review-redline-resolved" data-testid="lm-redline-resolved">
          <summary className="lm-meta">
            已处理 {resolved.length} 段（{resolved.filter((h) => h.status === "accepted").length}{" "}
            接受 · {resolved.filter((h) => h.status === "rejected").length} 拒绝）
          </summary>
          <ul className="lm-review-redline-list lm-review-redline-list--resolved">
            {resolved.map((h) => (
              <li
                key={h.hunkId}
                className={`lm-review-redline-item lm-review-redline-item--${h.status}`}
              >
                <div className="lm-meta">
                  {h.status === "accepted" ? "已接受" : "已拒绝"}
                  {h.sectionHeading
                    ? ` · ${h.sectionHeading}`
                    : ` · 第 ${h.sectionIndex + 1} 节`}
                </div>
                <pre className="lm-diff-remove lm-diff-muted">{h.before || "（空）"}</pre>
                <pre className="lm-diff-add lm-diff-muted">{h.after || "（空）"}</pre>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
