import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { apiGetJson, errorMessage } from "../api-client.js";

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

export function MatterReviewMatrixPanel({ apiBase, matterId, onOpenReview }: Props) {
  const [matrix, setMatrix] = useState<MatterReviewMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

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

  const cellMap = useMemo(() => {
    const m = new Map<string, ReviewMatrixCell>();
    for (const c of matrix?.cells ?? []) {
      m.set(`${c.documentId}::${c.questionId}`, c);
    }
    return m;
  }, [matrix?.cells]);

  if (loading) {
    return <p>加载审查矩阵…</p>;
  }
  if (err) {
    return <div className="lm-error">{err}</div>;
  }
  if (!matrix || matrix.documents.length === 0) {
    return (
      <div className="lm-workbench-panel">
        <h3>审查矩阵</h3>
        <p className="lm-hint">暂无草稿或研究来源。请先在本案件生成草稿或完成检索。</p>
        <button type="button" onClick={() => void reload()}>
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
          行 = 草稿/来源/卷宗文件；列 = 尽调问题。摘录为启发式建议，需律师核实。
        </p>
        <button type="button" className="lm-btn-ghost" onClick={() => void reload()}>
          刷新
        </button>
      </header>
      <div className="lm-review-matrix__scroll">
        <table className="lm-review-matrix__table">
          <thead>
            <tr>
              <th className="lm-review-matrix__corner">文档 ↓ / 问题 →</th>
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
                  <span>{doc.title}</span>
                  <span className="lm-meta">
                    {doc.kind === "draft" ? "草稿" : "来源"}
                    {doc.taskId ? ` · ${doc.taskId}` : ""}
                  </span>
                  {doc.kind === "draft" && doc.taskId && onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn-ghost"
                      onClick={() => onOpenReview({ taskId: doc.taskId, matterId })}
                    >
                      打开审核
                    </button>
                  ) : null}
                </th>
                {matrix.questions.map((q) => {
                  const cell = cellMap.get(`${doc.documentId}::${q.id}`);
                  const noteKey = `${doc.documentId}::${q.id}`;
                  const note = notes[noteKey] ?? "";
                  return (
                    <td key={q.id} className={cell?.status === "empty" ? "lm-review-matrix__empty" : undefined}>
                      {cell?.excerpt ? (
                        <p className="lm-review-matrix__excerpt" title="系统建议摘录">
                          {cell.excerpt}
                        </p>
                      ) : (
                        <span className="lm-meta">—</span>
                      )}
                      <textarea
                        className="lm-review-matrix__note"
                        rows={2}
                        placeholder="律师批注…"
                        value={note}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [noteKey]: e.target.value }))
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
