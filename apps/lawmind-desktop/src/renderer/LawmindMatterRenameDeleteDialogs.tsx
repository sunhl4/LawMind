import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPost } from "./lawmind-api-routes.ts";

export type LawmindMatterDeleteDialogProps = {
  open: { matterId: string; label: string } | null;
  apiBase: string;
  onClose: () => void;
  onSuccess?: (matterId: string) => void;
  onListChanged?: () => void;
};

export function LawmindMatterDeleteDialog({
  open,
  apiBase,
  onClose,
  onSuccess,
  onListChanged,
}: LawmindMatterDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [confirmMatterId, setConfirmMatterId] = useState("");
  const deleteSubmitLockRef = useRef(false);

  useEffect(() => {
    if (open) {
      setDeleteErr(null);
      setBusy(false);
      setConfirmMatterId("");
      deleteSubmitLockRef.current = false;
    }
  }, [open]);

  const submit = useCallback(async () => {
    const base = apiBase.trim();
    const mid = open?.matterId?.trim();
    if (!base || !mid) {
      return;
    }
    if (deleteSubmitLockRef.current) {
      return;
    }
    deleteSubmitLockRef.current = true;
    setDeleteErr(null);
    setBusy(true);
    try {
      const j = await apiPost(base, "/api/matters/delete", { matterId: mid });
      if (!j.ok) {
        setDeleteErr(messageFromOkFalseBody(j, "删除失败"));
        return;
      }
      onClose();
      onSuccess?.(mid);
      onListChanged?.();
    } catch (e) {
      setDeleteErr(errorMessage(e, "删除失败"));
    } finally {
      deleteSubmitLockRef.current = false;
      setBusy(false);
    }
  }, [apiBase, open?.matterId, onClose, onSuccess, onListChanged]);

  if (!open) {
    return null;
  }
  const confirmationRequiredId = open.matterId.trim();
  const confirmMatched = confirmMatterId.trim() === confirmationRequiredId;

  return (
    <div
      className="lm-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="删除案件"
      style={{ zIndex: "var(--z-toast)" }}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="lm-wizard lm-modal-matter-delete" onClick={(e) => e.stopPropagation()}>
        <h2>删除案件</h2>
        <p className="lm-meta">
          若磁盘上存在目录 <code className="lm-meta">{`cases/${open.matterId}`}</code>
          ，将<strong>整夹删除</strong>（CASE、策略、子文件夹与材料）。若该夹已不存在（例如仅历史任务里出现过本条），确认后也会成功并从列表刷新。对话中关联的本案会清除；历史任务里的编号不会自动改写。
        </p>
        <p className="lm-meta">
          当前案件：<strong>{open.label}</strong>（<code className="lm-meta">{open.matterId}</code>）
        </p>
        <label className="lm-field-match-confirm">
          <span>
            输入案件编号 <code className="lm-meta">{confirmationRequiredId}</code> 以确认删除
          </span>
          <input
            className="lm-input"
            value={confirmMatterId}
            onChange={(event) => setConfirmMatterId(event.target.value)}
            placeholder={confirmationRequiredId}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {deleteErr ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{deleteErr}</p>
          </div>
        ) : null}
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" disabled={busy} onClick={() => onClose()}>
            取消
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-destructive"
            disabled={busy || !confirmMatched}
            onClick={() => void submit()}
          >
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
