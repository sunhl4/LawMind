import { useCallback, useEffect, useState } from "react";
import { errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPost } from "./lawmind-api-routes.ts";

export type LawmindCreateMatterDialogProps = {
  open: boolean;
  apiBase: string;
  onClose: () => void;
  /** 创建成功并已落盘后的 matterId */
  onSuccess?: (matterId: string) => void;
};

export function LawmindCreateMatterDialog({
  open,
  apiBase,
  onClose,
  onSuccess,
}: LawmindCreateMatterDialogProps) {
  const [matterId, setMatterId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMatterId("");
    setDisplayName("");
    setErr(null);
    setBusy(false);
  }, [open]);

  const submit = useCallback(async () => {
    const base = apiBase.trim();
    if (!base) {
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const payload: { matterId: string; displayName?: string } = { matterId: matterId.trim() };
      const dn = displayName.trim();
      if (dn) {
        payload.displayName = dn;
      }
      const j = await apiPost(base, "/api/matters/create", payload);
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "创建案件失败"));
      }
      const mid = typeof j.matterId === "string" ? j.matterId.trim() : "";
      onClose();
      if (mid) {
        onSuccess?.(mid);
      }
    } catch (e) {
      setErr(errorMessage(e, "创建失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, matterId, displayName, onClose, onSuccess]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="lm-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="新建案件"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="lm-wizard lm-modal-matter-create" onClick={(e) => e.stopPropagation()}>
        <h2>新建案件</h2>
        <p className="lm-meta">2–128 字符，字母或数字开头。</p>
        <label className="lm-field">
          <span>案件编号</span>
          <input
            type="text"
            value={matterId}
            onChange={(e) => setMatterId(e.target.value)}
            placeholder="例如 matter-2026-001"
            autoComplete="off"
            disabled={busy}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <label className="lm-field">
          <span>案件名称（侧栏显示，可选）</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如 · 张三房屋租赁纠纷"
            autoComplete="off"
            disabled={busy}
          />
        </label>
        {err ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{err}</p>
          </div>
        ) : null}
        <div className="lm-wizard-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            onClick={() => onClose()}
          >
            取消
          </button>
          <button
            type="button"
            className="lm-btn"
            disabled={busy || !matterId.trim()}
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
