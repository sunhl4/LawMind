/**
 * 首跑向导重开总线：设置（高级）里点「重新打开首跑向导」时通知覆盖层打开对话框。
 *
 * 冷启动不再强制走向导（钥匙验证后直接进对话），但向导本身仍然可用：
 * 想补偏好、看文书类型的律师可随时重开。重开时不再重复建演示案件。
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeFirstRunReopen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestFirstRunReopen(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** 重开时不希望再走「自动打开」判定（那不是冷启动）。 */
export function clearFirstRunDismissal(): void {
  try {
    window.localStorage.removeItem("lm.firstRun.dismissed");
  } catch {
    /* ignore */
  }
}
