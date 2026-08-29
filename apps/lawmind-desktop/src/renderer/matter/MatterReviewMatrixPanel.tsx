import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { compareMatrixExcerpts } from "../../../../../src/lawmind/matter/review-matrix-compare.ts";
import { apiGetJson, errorMessage } from "../api-client.js";
import {
  loadReviewMatrixNotes,
  matrixCellKey,
  saveReviewMatrixNotes,
} from "./review-matrix-notes.js";

type ReviewMatrixQuestion = { id: string; label: string; hint?: string };
type ReviewMatrixDocument = {
  documentId: string;
  title: string;
  taskId: string;
  sourceId?: string;
  kind: "draft" | "source";
};
type ReviewMatrixCell = {
  documentId: string;
  questionId: string;
  excerpt: string;
  status: "empty" | "suggested" | "verified";
};
type MatterReviewMatrix = {
  matterId: string;
  questions: ReviewMatrixQuestion[];
  documents: ReviewMatrixDocument[];
  cells: ReviewMatrixCell[];
};

type Props = {
  apiBase: string;
  matterId: string;
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
};

const PREVIEW_LEN = 72;

export function MatterReviewMatrixPanel({ apiBase, matterId, onOpenReview }: Props) {
  const [matrix, setMatrix] = useState<MatterReviewMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notesReady, setNotesReady] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [compareBefore, setCompareBefore] = useState("");
  const [compareAfter, setCompareAfter] = useState("");
  const compareResult = useMemo(
    () =>
      compareBefore.trim() || compareAfter.trim()
        ? compareMatrixExcerpts(compareBefore, compareAfter)
        : null,
    [compareBefore, compareAfter],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; matrix?: MatterReviewMatrix }>(
        apiBase,
        `/api/matters/review-matrix?matterId=${encodeURIComponent(matterId)}`,
      );
      if (!j.ok || !j.matrix) {
        throw new Error("加载审查矩阵失败");
      }
      setMatrix(j.matrix);
    } catch (e) {
      setErr(errorMessage(e, "加载审查矩阵失败"));
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, matterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setNotesReady(false);
    const stored = loadReviewMatrixNotes(matterId);
    setNotes(stored.notes);
    setVerified(stored.verified);
    setExpanded({});
    setNotesReady(true);
  }, [matterId]);

  useEffect(() => {
    if (!notesReady) {
      return;
    }
    saveReviewMatrixNotes(matterId, { notes, verified });
  }, [matterId, notes, verified, notesReady]);

  const cellMap = useMemo(() => {
    const m = new Map<string, ReviewMatrixCell>();
    for (const c of matrix?.cells ?? []) {
      m.set(matrixCellKey(c.documentId, c.questionId), c);
    }
    return m;
  }, [matrix?.cells]);

  const gapSummary = useMemo(() => {
    if (!matrix) {
      return null;
    }
    let empty = 0;
    let pending = 0;
    let done = 0;
    for (const c of matrix.cells) {
      const key = matrixCellKey(c.documentId, c.questionId);
      if (verified[key]) {
        done += 1;
      } else if (!c.excerpt) {
        empty += 1;
      } else {
        pending += 1;
      }
    }
    return { empty, pending, done, total: matrix.cells.length };
  }, [matrix, verified]);

  if (loading) {
    return <p className="lm-meta">加载审查矩阵…</p>;
  }
  if (err) {
    return <div className="lm-error">{err}</div>;
  }
  if (!matrix || matrix.documents.length === 0) {
    return (
      <div className="lm-workbench-panel">
        <h3>审查矩阵</h3>
        <p className="lm-hint">暂无可对照材料。</p>
        <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => void reload()}>
          刷新
        </button>
      </div>
    );
  }

  return (
    <div className="lm-workbench-panel lm-review-matrix" data-testid="lm-review-matrix">
      <header className="lm-review-matrix__header">
        <h3>审查矩阵</h3>
        <p className="lm-hint">
          按问题对照材料；格子是线索，请核实后批注。
        </p>
        {gapSummary ? (
          <p className="lm-meta lm-review-matrix__summary" role="status">
            待核实 {gapSummary.pending} · 未见提及 {gapSummary.empty}
            {gapSummary.done > 0 ? ` · 已核实 ${gapSummary.done}` : ""}
          </p>
        ) : null}
        <div className="lm-review-matrix__actions">
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void reload()}>
            刷新
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-review-matrix-export"
            disabled={exportBusy}
            onClick={() => {
              void (async () => {
                setExportBusy(true);
                setErr(null);
                try {
                  const j = await apiGetJson<{ ok?: boolean; csv?: string }>(
                    apiBase,
                    `/api/matters/review-matrix/export?matterId=${encodeURIComponent(matterId)}`,
                  );
                  if (!j.ok || !j.csv) {
                    throw new Error("导出失败");
                  }
                  const blob = new Blob([j.csv], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `review-matrix-${matterId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setErr(errorMessage(e, "导出矩阵失败"));
                } finally {
                  setExportBusy(false);
                }
              })();
            }}
          >
            {exportBusy ? "导出中…" : "导出 CSV（含引用）"}
          </button>
        </div>
      </header>
      <details className="lm-review-matrix__compare" data-testid="lm-review-matrix-compare">
        <summary>版本比对（危险变更摘要）</summary>
        <p className="lm-meta">粘贴修改前/后条款摘录，检测高风险表述变化（本地规则，非全文 diff）。</p>
        <label className="lm-job-intake-field">
          <span>修改前</span>
          <textarea
            className="lm-input"
            rows={2}
            value={compareBefore}
            onChange={(e) => setCompareBefore(e.target.value)}
            data-testid="lm-matrix-compare-before"
          />
        </label>
        <label className="lm-job-intake-field">
          <span>修改后</span>
          <textarea
            className="lm-input"
            rows={2}
            value={compareAfter}
            onChange={(e) => setCompareAfter(e.target.value)}
            data-testid="lm-matrix-compare-after"
          />
        </label>
        {compareResult ? (
          <p
            className={compareResult.danger ? "lm-text-warn" : "lm-meta"}
            role="status"
            data-testid="lm-matrix-compare-summary"
          >
            {compareResult.summary}
          </p>
        ) : null}
      </details>
      <div className="lm-review-matrix__scroll">
        <table className="lm-review-matrix__table">
          <thead>
            <tr>
              <th className="lm-review-matrix__corner">材料</th>
              {matrix.questions.map((q) => (
                <th key={q.id} title={q.hint}>
                  {q.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.documents.map((doc) => (
              <tr key={doc.documentId}>
                <th className="lm-review-matrix__doc">
                  <span className="lm-review-matrix__doc-title">{doc.title}</span>
                  <span className="lm-meta">
                    {doc.kind === "draft" ? "草稿" : "材料"}
                  </span>
                  {doc.kind === "draft" && doc.taskId && onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={() => onOpenReview({ taskId: doc.taskId, matterId })}
                    >
                      改稿
                    </button>
                  ) : null}
                </th>
                {matrix.questions.map((q) => {
                  const key = matrixCellKey(doc.documentId, q.id);
                  const cell = cellMap.get(key);
                  const note = notes[key] ?? "";
                  const isVerified = Boolean(verified[key]) || cell?.status === "verified";
                  const excerpt = cell?.excerpt?.trim() ?? "";
                  const serverEmpty = cell?.status === "empty" || (!cell && !excerpt);
                  const isEmpty = serverEmpty || !excerpt;
                  const isSuggested = !isVerified && !isEmpty && (cell?.status === "suggested" || Boolean(excerpt));
                  const isOpen = Boolean(expanded[key]);
                  const preview =
                    excerpt.length > PREVIEW_LEN ? `${excerpt.slice(0, PREVIEW_LEN)}…` : excerpt;

                  return (
                    <td
                      key={q.id}
                      className={[
                        "lm-review-matrix__cell",
                        isEmpty ? "lm-review-matrix__empty" : "",
                        isSuggested ? "lm-review-matrix__suggested" : "",
                        isVerified ? "lm-review-matrix__verified" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-cell-status={cell?.status ?? (isEmpty ? "empty" : "suggested")}
                    >
                      <div className="lm-review-matrix__cell-status">
                        {isVerified ? (
                          <span className="lm-review-matrix__pill lm-review-matrix__pill--ok">已核实</span>
                        ) : isEmpty ? (
                          <span className="lm-review-matrix__pill lm-review-matrix__pill--empty">未见</span>
                        ) : (
                          <span className="lm-review-matrix__pill lm-review-matrix__pill--pending">
                            {cell?.status === "suggested" ? "系统建议" : "待核实"}
                          </span>
                        )}
                      </div>
                      {isEmpty ? (
                        <p className="lm-review-matrix__empty-label">本材料未直接提到此类问题</p>
                      ) : (
                        <>
                          <p className="lm-review-matrix__excerpt" title="系统线索摘录">
                            {isOpen ? excerpt : preview}
                          </p>
                          {excerpt.length > PREVIEW_LEN ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm lm-review-matrix__expand"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                            >
                              {isOpen ? "收起" : "展开"}
                            </button>
                          ) : null}
                        </>
                      )}
                      <label className="lm-review-matrix__verify">
                        <input
                          type="checkbox"
                          checked={isVerified}
                          onChange={(e) =>
                            setVerified((prev) => ({ ...prev, [key]: e.target.checked }))
                          }
                        />
                        <span>已核实</span>
                      </label>
                      <textarea
                        className="lm-review-matrix__note"
                        rows={2}
                        placeholder="律师批注…"
                        value={note}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MatterReviewMatrixPanel;
