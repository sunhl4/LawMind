/**
 * 品牌确认弹窗服务：window.confirm 的 promise 式替代。
 * 队列制——一次只展示一条，其余排队依次呈现；
 * 呈现由 LawmindConfirmDialogHost（挂在 LawmindModalHost）完成，
 * 本模块不依赖 React 树位置，hooks / 工具模块均可直接调用。
 * 订阅模型对齐 lawmind-clarify-bring-in-bus 的模块级总线。
 */

export type ConfirmDialogTone = "default" | "danger";

export type ConfirmDialogRequest = {
  title: string;
  /** 多行补充说明（pre-line 呈现）；无则只显示 title。 */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger：危险/不可恢复操作，主按钮用危险色。 */
  tone?: ConfirmDialogTone;
};

type PendingConfirm = {
  request: ConfirmDialogRequest;
  resolve: (ok: boolean) => void;
};

let current: PendingConfirm | null = null;
const queue: PendingConfirm[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** 打开一条确认弹窗；用户确认 resolve(true)，取消 / Esc / 遮罩 resolve(false)。 */
export function confirmDialog(request: ConfirmDialogRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const pending: PendingConfirm = { request, resolve };
    if (current) {
      queue.push(pending);
    } else {
      current = pending;
    }
    emit();
  });
}

/** Host 结案当前弹窗并自动展示下一条排队请求。 */
export function settleConfirmDialog(ok: boolean): void {
  const active = current;
  if (!active) {
    return;
  }
  current = queue.shift() ?? null;
  active.resolve(ok);
  emit();
}

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConfirmDialogSnapshot(): ConfirmDialogRequest | null {
  return current?.request ?? null;
}

/** 测试用：把当前与排队请求全部按「取消」结案，避免用例间串状态。 */
export function resetConfirmDialogQueueForTest(): void {
  const pending = [current, ...queue].filter((p): p is PendingConfirm => p !== null);
  current = null;
  queue.length = 0;
  for (const p of pending) {
    p.resolve(false);
  }
  emit();
}
