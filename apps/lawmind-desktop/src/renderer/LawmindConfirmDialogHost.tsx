/**
 * 品牌确认弹窗 Host：渲染 confirmDialog() 队列的当前条。
 * 挂在 LawmindModalHost（portal 到 body），层级高于其它弹窗。
 * 焦点管理：打开聚焦主按钮、关闭归还焦点、Tab 在弹窗内循环；
 * Esc / 遮罩点击 = 取消，Enter = 确认（按钮自身 Enter 走原生点击）。
 */
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  getConfirmDialogSnapshot,
  settleConfirmDialog,
  subscribeConfirmDialog,
} from "./lawmind-confirm-dialog";

export function LawmindConfirmDialogHost(): ReactNode {
  const request = useSyncExternalStore(subscribeConfirmDialog, getConfirmDialogSnapshot);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const danger = request?.tone === "danger";

  useEffect(() => {
    if (!request) {
      return;
    }
    restoreFocusRef.current = document.activeElement;
    primaryRef.current?.focus();
    return () => {
      const prev = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (prev instanceof HTMLElement && prev.isConnected) {
        prev.focus();
      }
    };
  }, [request]);

  if (!request) {
    return null;
  }

  const settle = (ok: boolean) => settleConfirmDialog(ok);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      settle(false);
      return;
    }
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      settle(true);
      return;
    }
    if (e.key === "Tab") {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="lm-wizard-backdrop lm-confirm-dialog-backdrop"
      onClick={() => settle(false)}
      data-testid="lm-confirm-dialog-backdrop"
    >
      <div
        ref={dialogRef}
        className={`lm-wizard ${danger ? "lm-wizard--danger" : "lm-wizard--confirm"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.body ? bodyId : undefined}
        data-testid="lm-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={danger ? "lm-wizard-title-danger" : undefined}>
          {request.title}
        </h2>
        {request.body ? (
          <p className="lm-wizard-body-pre" id={bodyId}>
            {request.body}
          </p>
        ) : null}
        <div className="lm-wizard-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            data-testid="lm-confirm-dialog-cancel"
            onClick={() => settle(false)}
          >
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className={`lm-btn${danger ? " lm-btn-destructive" : ""}`}
            data-testid="lm-confirm-dialog-ok"
            ref={primaryRef}
            onClick={() => settle(true)}
          >
            {request.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
