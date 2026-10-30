/**
 * 左下角「更新」药丸的状态源（Cursor 式更新体验）。
 *
 * 主进程在生命周期里推 `lawmind:app-update`：available → downloading(NN%) → downloaded。
 * 打开药丸点击 → `runAppUpdateAction`（主进程按状态给：静默检查 / 直接下载 /
 * 进度提示 / 「重启并安装」确认框）。
 *
 * 支持弹窗（aux window）与多窗口：每个窗口各自订阅推送；初始拉取兜底，
 * 早到的推送不会被迟到的一次性拉取结果回退（按 `updatedAt` 单调合并）。
 */

export type LawmindAppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type LawmindAppUpdateState = {
  status: LawmindAppUpdateStatus;
  version: string | null;
  percent: number | null;
  error: string | null;
  updatedAt: number;
};

const STATUSES: ReadonlySet<string> = new Set([
  "unsupported",
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "error",
]);

const IDLE_STATE: LawmindAppUpdateState = {
  status: "idle",
  version: null,
  percent: null,
  error: null,
  updatedAt: 0,
};

let state: LawmindAppUpdateState = IDLE_STATE;
let wired = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

/** 单调合并状态推送；非法/过期载荷忽略，保证快照引用只在真变化时更新。 */
export function applyLawmindAppUpdatePayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const raw = payload as {
    status?: unknown;
    version?: unknown;
    percent?: unknown;
    error?: unknown;
    updatedAt?: unknown;
  };
  if (typeof raw.status !== "string" || !STATUSES.has(raw.status)) {
    return;
  }
  const updatedAt = typeof raw.updatedAt === "number" && raw.updatedAt >= 0 ? raw.updatedAt : Date.now();
  if (updatedAt < state.updatedAt) {
    return;
  }
  const percent =
    typeof raw.percent === "number" ? Math.min(100, Math.max(0, Math.round(raw.percent))) : null;
  // 下载进度事件不带 version（缺省 = 沿用）；显式的 null 表示清空（如「已是最新」）。
  const version =
    raw.version === undefined
      ? state.version
      : typeof raw.version === "string" && raw.version.trim()
        ? raw.version.trim()
        : null;
  state = {
    status: raw.status as LawmindAppUpdateStatus,
    version,
    percent,
    error: typeof raw.error === "string" && raw.error.trim() ? raw.error.trim() : null,
    updatedAt,
  };
  emit();
}

function ensureWired() {
  if (wired) {
    return;
  }
  wired = true;
  const api = window.lawmindDesktop;
  if (!api?.onAppUpdateState || !api.getAppUpdateState) {
    return;
  }
  // 推送 + 兜底拉取；拉取结果可能比已收到的推送旧，apply 内按 updatedAt 丢弃。
  api.onAppUpdateState((payload) => applyLawmindAppUpdatePayload(payload));
  void api
    .getAppUpdateState()
    .then((initial) => applyLawmindAppUpdatePayload(initial))
    .catch(() => {
      /* 主进程尚未就绪时静默，等下一次推送 */
    });
}

/** React `useSyncExternalStore` 订阅。 */
export function subscribeLawmindAppUpdate(listener: () => void): () => void {
  ensureWired();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React `useSyncExternalStore` 快照。 */
export function getLawmindAppUpdateSnapshot(): LawmindAppUpdateState {
  return state;
}

/** 药丸是否亮起（金色「更新」）。error / idle / unsupported 不打扰用户。 */
export function isLawmindAppUpdatePillVisible(
  state: Pick<LawmindAppUpdateState, "status">,
): boolean {
  return state.status === "available" || state.status === "downloading" || state.status === "downloaded";
}

/** 药丸文案：下载中带进度，就绪后是 Cursor 风格的「更新」。 */
export function lawmindAppUpdatePillLabel(
  state: Pick<LawmindAppUpdateState, "status" | "percent">,
): string {
  if (state.status === "downloading" && typeof state.percent === "number") {
    return `更新 ${state.percent}%`;
  }
  return "更新";
}

/** 点击「更新」药丸（交给主进程按状态分派）。主进程已兜底错误，这里只防 IPC 本身失联。 */
export async function runLawmindAppUpdateAction(): Promise<void> {
  try {
    await window.lawmindDesktop?.runAppUpdateAction?.();
  } catch {
    /* 窗口正在销毁 / 主进程重启：忽略，下一次状态推送会纠正界面 */
  }
}
