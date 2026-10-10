/**
 * Middle-column xlsx surface — Excel/WPS-like grid with cell editing.
 * Styles/merges come from the file; edits write back via /api/fs/xlsx-save.
 * No Office ribbon; structural work still goes to the agent or「用本机应用打开」.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";
import type { OpenFileTab } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";
import { caretIndexFromClientX } from "./xlsx-caret";
import { formatXlsxEditValue, parseXlsxEditInput, type XlsxEditValue } from "./xlsx-edit-value";
import {
  cellStyleToCss,
  columnLetters,
  type XlsxPreviewCellStyle,
} from "./xlsx-preview-style";

type CaretIntent =
  | { mode: "click"; clientX: number }
  | { mode: "end" }
  | { mode: "replace" };

function conflictMtimeFromError(err: unknown): number | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  const rec = err as { status?: unknown; body?: { mtimeMs?: unknown } | null };
  if (rec.status !== 409) {
    return null;
  }
  const mtime = Number(rec.body?.mtimeMs);
  return Number.isFinite(mtime) ? mtime : null;
}

export type XlsxPreviewCell = {
  v: XlsxEditValue;
  s?: XlsxPreviewCellStyle;
  rs?: number;
  cs?: number;
} | null;

export type XlsxSheetPreview = {
  name: string;
  colCount: number;
  colWidthsPx: number[];
  rowHeightsPx: Array<number | null>;
  cells: XlsxPreviewCell[][];
  truncatedRows: boolean;
};

export type XlsxPreviewResponse = {
  ok: true;
  sheets: XlsxSheetPreview[];
  truncatedSheets: boolean;
  /** Disk mtime after preview load (use for optimistic save). */
  mtimeMs: number;
};

export type XlsxFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

const UI_ROW_CAP = 500;

type CellCoord = { sheetIndex: number; row: number; col: number };

function editKey(sheetIndex: number, row: number, col: number): string {
  return `${sheetIndex}:${row}:${col}`;
}

function displayValue(
  sheets: XlsxSheetPreview[],
  edits: Map<string, XlsxEditValue>,
  sheetIndex: number,
  row: number,
  col: number,
): XlsxEditValue {
  const key = editKey(sheetIndex, row, col);
  if (edits.has(key)) {
    return edits.get(key) ?? null;
  }
  return sheets[sheetIndex]?.cells[row]?.[col]?.v ?? null;
}

type SheetGridProps = {
  sheet: XlsxSheetPreview;
  sheetIndex: number;
  edits: Map<string, XlsxEditValue>;
  selected: CellCoord | null;
  editing: CellCoord | null;
  draft: string;
  caretIntentRef: MutableRefObject<CaretIntent | null>;
  onBeginEditAtClick: (coord: CellCoord, clientX: number) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (move: "stay" | "down" | "right" | "cancel") => void;
};

function SheetGrid(props: SheetGridProps): ReactNode {
  const {
    sheet,
    sheetIndex,
    edits,
    selected,
    editing,
    draft,
    caretIntentRef,
    onBeginEditAtClick,
    onDraftChange,
    onCommitEdit,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef(false);
  const rows = sheet.cells.slice(0, UI_ROW_CAP);
  const colCount = Math.max(1, Math.min(sheet.colCount, sheet.colWidthsPx.length || sheet.colCount));

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const intent = caretIntentRef.current;
    caretIntentRef.current = null;
    const len = input.value.length;
    if (intent?.mode === "click") {
      const idx = caretIndexFromClientX(input, intent.clientX);
      input.setSelectionRange(idx, idx);
    } else if (intent?.mode === "replace") {
      input.setSelectionRange(len, len);
    } else {
      // F2 / Enter: caret at end — never select the whole cell.
      input.setSelectionRange(len, len);
    }
  }, [editing?.row, editing?.col, editing?.sheetIndex, caretIntentRef]);

  return (
    <div className="lm-xlsx-grid-scroll lm-scroll" data-testid="lm-xlsx-grid-scroll" tabIndex={-1}>
      <table className="lm-xlsx-grid lm-xlsx-grid--excel" data-testid="lm-xlsx-grid">
        <colgroup>
          <col style={{ width: 40 }} />
          {Array.from({ length: colCount }, (_, colIndex) => (
            <col key={colIndex} style={{ width: sheet.colWidthsPx[colIndex] ?? 64 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="lm-xlsx-corner" scope="col" />
            {Array.from({ length: colCount }, (_, colIndex) => (
              <th key={colIndex} className="lm-xlsx-col-head" scope="col">
                {columnLetters(colIndex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const height = sheet.rowHeightsPx[rowIndex];
            const rowStyle: CSSProperties | undefined = height != null ? { height } : undefined;
            return (
              <tr key={rowIndex} style={rowStyle}>
                <th className="lm-xlsx-row-head" scope="row">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: colCount }, (_, colIndex) => {
                  const cell = row[colIndex];
                  if (cell === null) {
                    return null;
                  }
                  const entry = cell ?? { v: null };
                  const coord = { sheetIndex, row: rowIndex, col: colIndex };
                  const isSelected =
                    selected?.sheetIndex === sheetIndex &&
                    selected.row === rowIndex &&
                    selected.col === colIndex;
                  const isEditing =
                    editing?.sheetIndex === sheetIndex &&
                    editing.row === rowIndex &&
                    editing.col === colIndex;
                  const shown = edits.has(editKey(sheetIndex, rowIndex, colIndex))
                    ? (edits.get(editKey(sheetIndex, rowIndex, colIndex)) ?? null)
                    : entry.v;
                  const className = [
                    "lm-xlsx-cell",
                    isSelected ? "lm-xlsx-cell-selected" : "",
                    isEditing ? "lm-xlsx-cell-editing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td
                      key={colIndex}
                      className={className}
                      rowSpan={entry.rs && entry.rs > 1 ? entry.rs : undefined}
                      colSpan={entry.cs && entry.cs > 1 ? entry.cs : undefined}
                      style={cellStyleToCss(entry.s)}
                      onMouseDown={(e) => {
                        if (e.button !== 0) {
                          return;
                        }
                        if (isEditing) {
                          // Already editing this cell — let the input place the caret.
                          return;
                        }
                        e.preventDefault();
                        onBeginEditAtClick(coord, e.clientX);
                      }}
                      data-testid={`lm-xlsx-cell-${rowIndex}-${colIndex}`}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="lm-xlsx-cell-input"
                          value={draft}
                          spellCheck={false}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          data-1p-ignore
                          data-lpignore="true"
                          aria-label="单元格"
                          onChange={(e) => onDraftChange(e.target.value)}
                          onBlur={() => {
                            if (ignoreBlurRef.current) {
                              ignoreBlurRef.current = false;
                              return;
                            }
                            onCommitEdit("stay");
                          }}
                          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              ignoreBlurRef.current = true;
                              onCommitEdit("down");
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              ignoreBlurRef.current = true;
                              onCommitEdit("right");
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              ignoreBlurRef.current = true;
                              onCommitEdit("cancel");
                            }
                          }}
                        />
                      ) : (
                        formatXlsxEditValue(shown)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function XlsxFileView(props: XlsxFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [sheets, setSheets] = useState<XlsxSheetPreview[]>([]);
  const [truncatedSheets, setTruncatedSheets] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [edits, setEdits] = useState<Map<string, XlsxEditValue>>(() => new Map());
  const [selected, setSelected] = useState<CellCoord | null>(null);
  const [editing, setEditing] = useState<CellCoord | null>(null);
  const [draft, setDraft] = useState("");
  const [fileMtimeMs, setFileMtimeMs] = useState(tab.mtimeMs);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const caretIntentRef = useRef<CaretIntent | null>(null);
  draftRef.current = draft;
  const requestKey = useMemo(
    () => `${apiBase}|${tab.root}|${tab.path}|${tab.mtimeMs}`,
    [apiBase, tab.root, tab.path, tab.mtimeMs],
  );
  const dirty = edits.size > 0;

  const reload = useCallback(async () => {
    const body = await apiGetJson<XlsxPreviewResponse>(
      apiBase,
      `/api/fs/xlsx-preview?${new URLSearchParams({ root: tab.root, path: tab.path }).toString()}`,
    );
    setSheets(body.sheets);
    setTruncatedSheets(body.truncatedSheets);
    if (typeof body.mtimeMs === "number" && Number.isFinite(body.mtimeMs)) {
      setFileMtimeMs(body.mtimeMs);
    }
    return body;
  }, [apiBase, tab.root, tab.path]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setLoadError(null);
    setSaveError(null);
    setSheets([]);
    setSheetIndex(0);
    setEdits(new Map());
    setSelected(null);
    setEditing(null);
    setFileMtimeMs(tab.mtimeMs);
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份表格。");
      setBusy(false);
    } else {
      void (async () => {
        try {
          await reload();
        } catch (err) {
          if (!cancelled) {
            setLoadError(errorMessage(err, "读不到这份表格。"));
          }
        } finally {
          if (!cancelled) {
            setBusy(false);
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [requestKey, apiBase, tab.mtimeMs, reload]);

  const startEdit = useCallback(
    (coord: CellCoord, intent: CaretIntent, seed?: string) => {
      const base = displayValue(sheets, edits, coord.sheetIndex, coord.row, coord.col);
      caretIntentRef.current = intent;
      setSelected(coord);
      setEditing(coord);
      setDraft(seed !== undefined ? seed : formatXlsxEditValue(base));
    },
    [sheets, edits],
  );

  const commitEdit = useCallback(
    (move: "stay" | "down" | "right" | "cancel") => {
      setEditing((current) => {
        if (!current) {
          return null;
        }
        if (move !== "cancel") {
          const nextValue = parseXlsxEditInput(draftRef.current);
          const original = sheets[current.sheetIndex]?.cells[current.row]?.[current.col]?.v ?? null;
          setEdits((prev) => {
            const next = new Map(prev);
            const key = editKey(current.sheetIndex, current.row, current.col);
            const same =
              (nextValue == null && original == null) ||
              (typeof nextValue === "number" &&
                typeof original === "number" &&
                nextValue === original) ||
              nextValue === original;
            if (same) {
              next.delete(key);
            } else {
              next.set(key, nextValue);
            }
            return next;
          });
        }
        if (move === "down" || move === "right") {
          const sheet = sheets[current.sheetIndex];
          const maxRow = Math.min(UI_ROW_CAP, sheet?.cells.length ?? 1) - 1;
          const maxCol = Math.max(0, (sheet?.colCount ?? 1) - 1);
          let row = current.row;
          let col = current.col;
          if (move === "down") {
            row = Math.min(maxRow, row + 1);
          } else {
            col = Math.min(maxCol, col + 1);
          }
          while (
            sheet &&
            sheet.cells[row]?.[col] === null &&
            (move === "down" ? row < maxRow : col < maxCol)
          ) {
            if (move === "down") {
              row += 1;
            } else {
              col += 1;
            }
          }
          setSelected({ sheetIndex: current.sheetIndex, row, col });
        }
        return null;
      });
    },
    [sheets],
  );

  const beginEditAtClick = useCallback(
    (coord: CellCoord, clientX: number) => {
      if (
        editing &&
        (editing.sheetIndex !== coord.sheetIndex ||
          editing.row !== coord.row ||
          editing.col !== coord.col)
      ) {
        commitEdit("stay");
      }
      startEdit(coord, { mode: "click", clientX });
    },
    [editing, commitEdit, startEdit],
  );

  const saveEdits = useCallback(async () => {
    if (!dirty || saving || !apiBase.trim()) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = [...edits.entries()].map(([key, value]) => {
        const [si, r, c] = key.split(":").map(Number);
        const sheet = sheets[si]?.name;
        if (!sheet) {
          throw new Error("工作表已失效，请重新打开。");
        }
        return { sheet, row: (r ?? 0) + 1, col: (c ?? 0) + 1, value };
      });
      const postSave = (expectedMtimeMs: number | undefined) =>
        apiSendJson<{ ok: true; mtimeMs: number }>(apiBase, "/api/fs/xlsx-save", "POST", {
          root: tab.root,
          path: tab.path,
          expectedMtimeMs,
          edits: payload,
        });

      let res: { ok: true; mtimeMs: number };
      try {
        res = await postSave(fileMtimeMs);
      } catch (err) {
        // Stale tab/preview mtime is common after iCloud materialize. Retry with
        // the disk mtime from 409; if still conflicting, overwrite (single-user desktop).
        const conflictMtime = conflictMtimeFromError(err);
        if (conflictMtime == null) {
          throw err;
        }
        setFileMtimeMs(conflictMtime);
        try {
          res = await postSave(conflictMtime);
        } catch (err2) {
          if (conflictMtimeFromError(err2) == null) {
            throw err2;
          }
          res = await postSave(undefined);
        }
      }
      setEdits(new Map());
      setFileMtimeMs(res.mtimeMs);
      await reload();
    } catch (err) {
      const msg = conflictMtimeFromError(err)
        ? "保存冲突：文件已在外部被改过。请关闭后重新打开再改。"
        : errorMessage(err, "保存失败。");
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, apiBase, edits, sheets, tab.root, tab.path, fileMtimeMs, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!paneRef.current) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (dirty) {
          e.preventDefault();
          e.stopPropagation();
          void saveEdits();
        }
        return;
      }
      if (editing) {
        return;
      }
      if (!selected || selected.sheetIndex !== sheetIndex) {
        return;
      }
      if (e.key === "F2" || e.key === "Enter") {
        e.preventDefault();
        startEdit(selected, { mode: "end" });
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        startEdit(selected, { mode: "replace" }, e.key);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dirty, saveEdits, editing, selected, sheetIndex, startEdit]);

  const active = sheets[sheetIndex] ?? sheets[0];

  return (
    <div
      ref={paneRef}
      className="lm-editor-pane lm-xlsx-preview-pane"
      data-testid="lm-preview-xlsx"
    >
      <div className="lm-editor-header">
        <div className="lm-xlsx-edit-status">
          {dirty ? <span className="lm-dot lm-dot-warn">未保存</span> : null}
          {saveError ? (
            <span className="lm-meta" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
        <div className="lm-editor-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            data-testid="lm-xlsx-save"
            disabled={!dirty || saving}
            title="保存到当前文件（⌘S）"
            onClick={() => void saveEdits()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {actions.onAddToChatContext ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              data-testid="lm-xlsx-ask-agent"
              onClick={() =>
                actions.onAddToChatContext?.({ root: tab.root, relPath: tab.path, kind: "file" })
              }
            >
              让助手处理这张表
            </button>
          ) : null}
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      {loadError ? (
        <div className="lm-office-doc-body">
          <p className="lm-office-doc-copy" role="alert">
            {loadError}
          </p>
        </div>
      ) : busy ? (
        <div className="lm-office-doc-body">
          <p className="lm-meta">正在打开表格…</p>
        </div>
      ) : (
        <div className="lm-xlsx-preview-body">
          {active ? (
            <SheetGrid
              sheet={active}
              sheetIndex={sheetIndex}
              edits={edits}
              selected={selected?.sheetIndex === sheetIndex ? selected : null}
              editing={editing?.sheetIndex === sheetIndex ? editing : null}
              draft={draft}
              caretIntentRef={caretIntentRef}
              onBeginEditAtClick={beginEditAtClick}
              onDraftChange={setDraft}
              onCommitEdit={commitEdit}
            />
          ) : null}
          {(active?.truncatedRows || truncatedSheets || (active?.cells.length ?? 0) > UI_ROW_CAP) && (
            <p className="lm-meta lm-xlsx-preview-note">
              仅编辑前 {UI_ROW_CAP} 行
              {truncatedSheets ? "；工作表数量已截断" : ""}
              。复杂排版可用「用本机应用打开」。
            </p>
          )}
          <div className="lm-xlsx-sheet-bar" role="tablist" aria-label="工作表">
            {sheets.map((sheet, index) => (
              <button
                key={`${sheet.name}-${index}`}
                type="button"
                role="tab"
                aria-selected={index === sheetIndex}
                className={
                  index === sheetIndex
                    ? "lm-xlsx-sheet-tab lm-xlsx-sheet-tab-active"
                    : "lm-xlsx-sheet-tab"
                }
                data-testid={`lm-xlsx-sheet-tab-${index}`}
                onClick={() => {
                  if (editing) {
                    commitEdit("stay");
                  }
                  setSheetIndex(index);
                  setSelected(null);
                }}
              >
                {sheet.name || `Sheet${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
