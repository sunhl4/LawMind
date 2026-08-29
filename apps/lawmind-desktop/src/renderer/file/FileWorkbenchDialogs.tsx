import type { Dispatch, SetStateAction } from "react";
import { type ConfirmDialog } from "./file-workbench-types";
import { basename } from "./file-workbench-fs";
import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";

export type FileWorkbenchDialogsProps = {
  busy: boolean;
  mattersPickList?: Array<{ id: string; label: string }> | null;
  confirmDialog: ConfirmDialog | null;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialog | null>>;
  dangerInput: string;
  setDangerInput: Dispatch<SetStateAction<string>>;
  addToMatterPick: { relPath: string; kind: "file" | "directory" } | null;
  setAddToMatterPick: Dispatch<SetStateAction<{ relPath: string; kind: "file" | "directory" } | null>>;
  addToMatterManualDraft: string;
  setAddToMatterManualDraft: Dispatch<SetStateAction<string>>;
  addToMatterLastError: string | null;
  setAddToMatterLastError: Dispatch<SetStateAction<string | null>>;
  moveWorkspaceItemIntoMatter: (
    matterId: string,
    relPath: string,
    kind: "file" | "directory",
  ) => void | Promise<void>;
};

export function FileWorkbenchDialogs({
  busy,
  mattersPickList,
  confirmDialog,
  setConfirmDialog,
  dangerInput,
  setDangerInput,
  addToMatterPick,
  setAddToMatterPick,
  addToMatterManualDraft,
  setAddToMatterManualDraft,
  addToMatterLastError,
  setAddToMatterLastError,
  moveWorkspaceItemIntoMatter,
}: FileWorkbenchDialogsProps) {
  const addToMatterPicker = (() => {
    if (!addToMatterPick) {
      return null;
    }
    const leaf = basename(addToMatterPick.relPath);
    const manualTrim = addToMatterManualDraft.trim();
    const manualOk = isValidMatterId(manualTrim);
    const openList = mattersPickList !== null && mattersPickList !== undefined && mattersPickList.length > 0;
    return (
      <div
        className="lm-wizard-backdrop"
        style={{ zIndex: 21_000 }}
        role="dialog"
        aria-modal="true"
        aria-label="加入案件"
        onClick={() => {
          if (!busy) {
            setAddToMatterPick(null);
          }
        }}
      >
        <div className="lm-wizard lm-wizard--detail" onClick={(e) => e.stopPropagation()}>
          <h2>加入案件</h2>
          <p className="lm-wizard-lead">
            将「{leaf}」移入案件卷宗文件夹（<code className="lm-meta">cases/…/</code>）。重名时自动追加序号。
          </p>
          {openList ? (
            <>
              <p className="lm-wizard-lead" style={{ marginBottom: 10, fontSize: 13, opacity: 0.92 }}>从列表选择</p>
              <div className="lm-matter-pick-list" style={{ maxHeight: "min(40vh, 240px)", overflow: "auto" }}>
                {mattersPickList.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: 8, textAlign: "left" }}
                    disabled={busy}
                    onClick={() => void moveWorkspaceItemIntoMatter(m.id, addToMatterPick.relPath, addToMatterPick.kind)}
                  >
                    <span style={{ fontWeight: 600, marginRight: 8 }}>{m.label}</span>
                    <span className="lm-meta">{m.id}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="lm-field lm-field--spaced" style={{ marginTop: openList ? 18 : 0 }}>
            <label className="lm-field-label" htmlFor="lawmind-add-matter-manual-id">
              {openList ? "或手动输入案件编号" : "输入案件编号"}
            </label>
            <input
              id="lawmind-add-matter-manual-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="字母或数字开头，如 Acme-2024-01"
              value={addToMatterManualDraft}
              onChange={(e) => {
                setAddToMatterManualDraft(e.target.value);
                setAddToMatterLastError(null);
              }}
            />
            {manualTrim && !manualOk ? (
              <p style={{ fontSize: 12, color: "var(--error)", marginTop: 8, lineHeight: 1.5 }}>
                编号须 2–128 位：字母或数字开头，可含英文句点、下划线、连字符。
              </p>
            ) : null}
          </div>
          {addToMatterLastError ? (
            <div className="lm-callout lm-callout-danger" role="alert" style={{ marginTop: 12 }}>
              <p className="lm-callout-body">{addToMatterLastError}</p>
            </div>
          ) : null}
          <div className="lm-wizard-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary"
              disabled={busy}
              onClick={() => setAddToMatterPick(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="lm-btn"
              disabled={busy || !manualOk}
              onClick={() => void moveWorkspaceItemIntoMatter(manualTrim, addToMatterPick.relPath, addToMatterPick.kind)}
            >
              用此编号移入
            </button>
          </div>
        </div>
      </div>
    );
  })();

  const confirmDialogNode = (() => {
    if (!confirmDialog) {return null;}
    if (confirmDialog.kind === "simple") {
      return (
        <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
          <div className="lm-wizard lm-wizard--confirm" onClick={(e) => e.stopPropagation()}>
            <p className="lm-wizard-lead">{confirmDialog.message}</p>
            <div className="lm-wizard-actions">
              <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
              <button type="button" className="lm-btn" onClick={confirmDialog.onConfirm}>确认</button>
            </div>
          </div>
        </div>
      );
    }
    const requiredName = confirmDialog.body.match(/"([^"]+)" 确认删除：/)?.[1] ?? "";
    const canConfirm = !requiredName || dangerInput.trim() === requiredName;
    return (
      <div className="lm-wizard-backdrop" onClick={() => setConfirmDialog(null)}>
        <div className="lm-wizard lm-wizard--danger" onClick={(e) => e.stopPropagation()}>
          <h2 className="lm-wizard-title-danger">{confirmDialog.title}</h2>
          <p className="lm-wizard-body-pre">{confirmDialog.body}</p>
          {requiredName && (
            <div className="lm-field lm-field--spaced lm-field-match-confirm">
              <input
                type="text"
                value={dangerInput}
                placeholder={`输入"${requiredName}"确认`}
                aria-invalid={!canConfirm}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setDangerInput(e.target.value)}
              />
            </div>
          )}
          <div className="lm-wizard-actions">
            <button type="button" className="lm-btn lm-btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
            <button type="button" className="lm-btn lm-btn-destructive" disabled={!canConfirm} onClick={confirmDialog.onConfirm}>
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <>
      {confirmDialogNode}
      {addToMatterPicker}
    </>
  );
}
