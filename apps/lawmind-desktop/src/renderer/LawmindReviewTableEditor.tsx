/**
 * 审查表编辑器（review.table）— 文书台内的轻量表格编辑。
 * 表格本体存 sidecar（GET/PATCH /api/drafts/:id/table）；保存后草稿「审查表」栏目
 * 在服务端同步 markdown 预览，与 agent 的 review_table_update 同一真相源。
 */

import { useCallback, useEffect, useState } from "react";
import { apiGetJson, apiSendJson } from "./api-client";

type ReviewTableColumn = { key: string; label: string };
type ReviewCellMeta = {
  source?: string;
  confidence?: "high" | "medium" | "low";
  abstained?: boolean;
  note?: string;
};
type ReviewTableRow = {
  id: string;
  cells: Record<string, string>;
  group?: string;
  source?: string;
  cellMeta?: Record<string, ReviewCellMeta>;
  review?: { reviewed?: boolean; locked?: boolean };
};

const ABSTAIN_TEXT = "无法判断（证据不足）";
const IDENTITY_KEYS = new Set(["document", "item", "exhibit", "clause", "name", "file", "doc", "source"]);
const IDENTITY_LABELS = new Set(["审查事项", "对应文件", "证据名称", "条款", "文件名", "事项", "来源"]);

function cellHint(row: ReviewTableRow, col: ReviewTableColumn): string {
  const key = col.key;
  const meta = row.cellMeta?.[key];
  const value = (row.cells[key] ?? "").trim();
  if (meta?.abstained || value === ABSTAIN_TEXT) {
    return meta?.note ? `弃答：${meta.note}` : "弃答";
  }
  if (meta?.source) {
    return `出处：${meta.source}`;
  }
  if (IDENTITY_KEYS.has(key) || IDENTITY_LABELS.has(col.label.trim())) {
    return "";
  }
  if (value) {
    return "缺出处";
  }
  return "";
}
type ReviewTable = {
  taskId: string;
  template: string;
  title: string;
  columns: ReviewTableColumn[];
  rows: ReviewTableRow[];
  updatedAt: string;
};

type Props = {
  taskId: string;
  apiBase: string;
  editable: boolean;
};

export function LawmindReviewTableEditor({ taskId, apiBase, editable }: Props) {
  const [table, setTable] = useState<ReviewTable | null>(null);
  const [missing, setMissing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    setTable(null);
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; table?: ReviewTable }>(
          apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}/table`,
        );
        if (cancelled) {
          return;
        }
        if (j.ok && j.table) {
          setTable(j.table);
        } else {
          setMissing(true);
        }
      } catch {
        if (!cancelled) {
          setMissing(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  const updateCell = useCallback((rowId: string, key: string, value: string) => {
    setTable((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.id !== rowId) {
            return row;
          }
          const cellMeta = { ...row.cellMeta };
          delete cellMeta[key];
          const { cellMeta: _dropped, ...rest } = row;
          return {
            ...rest,
            cells: { ...row.cells, [key]: value },
            ...(Object.keys(cellMeta).length > 0 ? { cellMeta } : {}),
          };
        }),
      };
    });
    setDirty(true);
  }, []);

  const addRow = useCallback(() => {
    setTable((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        rows: [
          ...prev.rows,
          { id: `row-${Math.random().toString(36).slice(2, 10)}`, cells: {} },
        ],
      };
    });
    setDirty(true);
  }, []);

  const unlockRow = useCallback((rowId: string) => {
    setTable((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        rows: prev.rows.map((row) =>
          row.id === rowId ? { ...row, review: { ...row.review, locked: false } } : row,
        ),
      };
    });
    setDirty(true);
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setTable((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, rows: prev.rows.filter((row) => row.id !== rowId) };
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!table || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; error?: string }, { columns: ReviewTableColumn[]; rows: ReviewTableRow[] }>(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}/table`,
        "PATCH",
        { columns: table.columns, rows: table.rows },
      );
      if (!j.ok) {
        throw new Error(j.error || "保存失败");
      }
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [apiBase, saving, table, taskId]);

  if (missing || !table) {
    return null;
  }

  return (
    <section className="lm-review-table-editor" aria-label="审查表" data-testid="lm-review-table-editor">
      <header className="lm-draft-doc-editor-header">
        <div className="lm-draft-doc-editor-header-main">
          <span className="lm-draft-doc-editor-kicker">审查表 · {table.title}</span>
          <span className="lm-draft-doc-editor-status" role="status">
            {table.rows.length} 行{dirty ? " · 未保存" : ""}
          </span>
        </div>
        <div className="lm-draft-doc-editor-actions">
          <a
            className="lm-btn lm-btn-ghost lm-btn-small"
            data-testid="lm-review-table-export-xlsx"
            href={`${apiBase}/api/drafts/${encodeURIComponent(taskId)}/table.xlsx`}
            download
          >
            下载 xlsx
          </a>
          {editable ? (
            <>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                disabled={saving}
                onClick={addRow}
              >
                加一行
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-small"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存表格"}
              </button>
            </>
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      <div className="lm-review-table-grid-wrap lm-scroll">
        <table className="lm-review-table-grid">
          <thead>
            <tr>
              {table.columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              {editable ? <th aria-label="操作" /> : null}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} data-testid="lm-review-table-row" data-locked={row.review?.locked ? "true" : undefined}>
                {table.columns.map((col) => {
                  const hint = cellHint(row, col);
                  return (
                  <td key={col.key}>
                    {editable ? (
                      <input
                        className="lm-input"
                        value={row.cells[col.key] ?? ""}
                        onChange={(e) => updateCell(row.id, col.key, e.target.value)}
                        disabled={saving || row.review?.locked === true}
                        title={hint || undefined}
                      />
                    ) : (
                      row.cells[col.key] ?? ""
                    )}
                    {hint ? <span className="lm-meta">{hint}</span> : null}
                  </td>
                  );
                })}
                {editable ? (
                  <td>
                    {row.review?.locked ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-small"
                        disabled={saving}
                        onClick={() => unlockRow(row.id)}
                      >
                        解除锁定
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-small"
                        disabled={saving}
                        onClick={() => removeRow(row.id)}
                        aria-label="删除此行"
                      >
                        删
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
