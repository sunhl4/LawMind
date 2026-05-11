import { useCallback, useEffect, useRef, useState } from "react";
import { apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";

export type LawmindMatterRenameDialogProps = {
  open: { matterId: string; initialTitle: string } | null;
  apiBase: string;
  onClose: () => void;
  onSuccess?: () => void;
};

export function LawmindMatterRenameDialog({
  open,
  apiBase,
  onClose,
  onSuccess,
}: LawmindMatterRenameDialogProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInput(open.initialTitle);
      setRenameErr(null);
      setBusy(false);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const base = apiBase.trim();
    const mid = open?.matterId?.trim();
    if (!base || !mid) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      setRenameErr("名称不能为空");
      return;
    }
    setRenameErr(null);
    setBusy(true);
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string },
        { matterId: string; displayName: string }
      >(base, "/api/matters/display-name", "POST", { matterId: mid, displayName: trimmed });
      if (!j.ok) {
        setRenameErr(messageFromOkFalseBody(j, "重命名失败"));
        return;
      }
      onClose();
      onSuccess?.();
    } catch (e) {
      setRenameErr(errorMessage(e, "重命名失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, open?.matterId, input, onClose, onSuccess]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="lm-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="重命名案件展示名称"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="lm-wizard lm-modal-matter-rename" onClick={(e) => e.stopPropagation()}>
        <h2>重命名展示名称</h2>
        <p className="lm-meta">仅影响左栏与列表中的显示名；案件编号与磁盘目录不变。</p>
        <label className="lm-field">
          <span>名称</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        {renameErr ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{renameErr}</p>
          </div>
        ) : null}
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" disabled={busy} onClick={() => onClose()}>
            取消
          </button>
          <button
            type="button"
            className="lm-btn"
            disabled={busy || !input.trim()}
            onClick={() => void submit()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const deleteSubmitLockRef = useRef(false);

  useEffect(() => {
    if (open) {
      setDeleteErr(null);
      setBusy(false);
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
      const j = await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
        base,
        "/api/matters/delete",
        "POST",
        { matterId: mid },
      );
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

  return (
    <div
      className="lm-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="删除案件"
      style={{ zIndex: 21_000 }}
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
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
