import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPost } from "./lawmind-api-routes.ts";
import { useModalFocusTrap } from "./use-modal-focus-trap";

export type LawmindCreateMatterDialogProps = {
  open: boolean;
  apiBase: string;
  onClose: () => void;
  /** 创建成功并已落盘后的 matterId */
  onSuccess?: (matterId: string) => void;
};

/**
 * 轻量建案：只填案件名（= 文件夹名）。客户/案由/接案确认在案件工作台「案件档案」事后补全。
 */
export function LawmindCreateMatterDialog({
  open,
  apiBase,
  onClose,
  onSuccess,
}: LawmindCreateMatterDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [caseName, setCaseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useModalFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCaseName("");
    setErr(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  const submit = useCallback(async () => {
    const base = apiBase.trim();
    const name = caseName.trim().replace(/[/\\]/g, "").replaceAll(String.fromCharCode(0), "");
    if (!base) {
      return;
    }
    if (!isValidMatterId(name)) {
      setErr("案件名至少 2 个字，且不能含路径字符（/ \\ ..）。");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const j = await apiPost(base, "/api/matters/create", {
        matterId: name,
        displayName: name,
      });
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "创建案件失败"));
      }
      const mid = typeof j.matterId === "string" ? j.matterId.trim() : name;
      onClose();
      if (mid) {
        onSuccess?.(mid);
      }
    } catch (e) {
      setErr(errorMessage(e, "创建失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, caseName, onClose, onSuccess]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="lm-wizard-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="lm-wizard lm-modal-matter-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="lm-modal-matter-create-head">
          <div className="lm-modal-matter-create-head-text">
            <h2 id={titleId}>新建案件</h2>
            <p className="lm-modal-matter-create-lead">
              只需案件名；将创建同名文件夹。客户、案由与接案确认可在案件工作台稍后补全。
            </p>
          </div>
          <button
            type="button"
            className="lm-modal-matter-create-close"
            aria-label="关闭"
            disabled={busy}
            onClick={() => onClose()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="lm-modal-matter-create-body">
          <label className="lm-field">
            <span>
              案件名 <span className="lm-modal-matter-create-req">必填</span>
            </span>
            <input
              type="text"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              placeholder="例如 张三买卖合同纠纷"
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
            <span className="lm-field-hint">将作为 cases/ 下文件夹名；支持中文</span>
          </label>
          {err ? (
            <p className="lm-error" role="alert">
              {err}
            </p>
          ) : null}
        </div>

        <footer className="lm-modal-matter-create-actions">
          <button type="button" className="lm-btn lm-btn-ghost" disabled={busy} onClick={() => onClose()}>
            取消
          </button>
          <button type="button" className="lm-btn" disabled={busy || !caseName.trim()} onClick={() => void submit()}>
            {busy ? "创建中…" : "创建"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
