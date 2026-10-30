/**
 * 应用内更新（Cursor 式体验）。
 *
 * 策略与 Cursor / VS Code 一致：
 * - 启动后台静默检查 + 每 4 小时复查；`electron-updater` 发现新版本即**自动下载**；
 * - 状态推送到所有渲染窗口（`lawmind:app-update`），左下角账号行的金色「更新」药丸
 *   随状态点亮：`更新 NN%`（下载中）→ `更新`（就绪，Cursor 的 "Restart to Update"）；
 * - 点击药丸：就绪态弹「重启并安装」确认框，确认后 `quitAndInstall()` 立即生效；
 *   即使用户不点，`autoInstallOnAppQuit = true` 也保证下次退出时装上新版本；
 * - 开发版 / `LAWMIND_SKIP_AUTO_UPDATE=1` / `LAWMIND_E2E=1` 停用（状态 `unsupported`），
 *   菜单「检查更新…」仍给出解释文案（`checkUpdatesWithUi`）。
 *
 * 可测性约束：不打静态 `import "electron"` / `electron-updater`，
 * electron 常量走惰性 `await import()`，核心状态机用 `createAppUpdateController` 注入。
 */

function errorMessage(e) {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === "string") {
    return e;
  }
  return "";
}

export const APP_UPDATE_CHANNEL = "lawmind:app-update";

export const APP_UPDATE_STATUS = Object.freeze({
  /** 本环境不可用（开发版 / 显式关闭 / E2E），界面不显示药丸。 */
  unsupported: "unsupported",
  /** 没有更新或尚未检查（静默态，不显示药丸）。 */
  idle: "idle",
  checking: "checking",
  /** 发现新版本；autoDownload=true 时是短暂过渡态，随即进入 downloading。 */
  available: "available",
  downloading: "downloading",
  /** 新版已下载完毕，可立即重启安装（Cursor 的 "Restart to Update" 态）。 */
  downloaded: "downloaded",
  error: "error",
});

/**
 * @typedef {Object} AppUpdateUiState
 * @property {string} status APP_UPDATE_STATUS 之一
 * @property {string | null} version 新版本号（available/downloading/downloaded 时有值）
 * @property {number | null} percent 下载百分比（downloading 时 0..100）
 * @property {string | null} error
 * @property {number} updatedAt 本Unix时间戳
 */

/**
 * 更新控制核心（纯状态机，测试友好）。
 *
 * @param {{
 *   loadUpdater: () => Promise<{
 *     on: (event: string, handler: (arg?: unknown) => void) => void;
 *     checkForUpdates: () => Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null>;
 *     downloadUpdate?: () => Promise<unknown>;
 *     quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
 *   } | null>;
 *   publish: (uiState: AppUpdateUiState) => void;
 *   isDisabled: () => boolean;
 * }} deps
 */
export function createAppUpdateController({ loadUpdater, publish, isDisabled }) {
  /** @type {AppUpdateUiState} */
  let uiState = {
    // 启用环境在首次检查前是「静默」而不是「不可用」，否则初次拉取会误报 unsupported。
    status: isDisabled() ? APP_UPDATE_STATUS.unsupported : APP_UPDATE_STATUS.idle,
    version: null,
    percent: null,
    error: null,
    updatedAt: 0,
  };
  /** @type {Promise<unknown> | null} */
  let updaterPromise = null;
  /** @type {unknown} 已接线（已注册事件）的 updater 实例；未接线时为 null */
  let updaterInstance = null;
  let wired = false;
  let installStarted = false;

  const setState = (partial) => {
    uiState = { ...uiState, ...partial, updatedAt: Date.now() };
    publish(uiState);
  };

  const describeInfo = (info) => ({
    version:
      info && typeof info === "object" && typeof info.version === "string" ? info.version : null,
  });

  const wireUpdater = (updater) => {
    if (wired) {
      return updater;
    }
    wired = true;
    updater.on("checking-for-update", () => {
      setState({
        status: APP_UPDATE_STATUS.checking,
        version: null,
        percent: null,
        error: null,
      });
    });
    updater.on("update-available", (info) => {
      setState({
        status: APP_UPDATE_STATUS.available,
        percent: null,
        error: null,
        ...describeInfo(info),
      });
    });
    updater.on("update-not-available", () => {
      setState({
        status: APP_UPDATE_STATUS.idle,
        version: null,
        percent: null,
        error: null,
      });
    });
    updater.on("download-progress", (progress) => {
      const raw =
        progress && typeof progress === "object" && typeof progress.percent === "number"
          ? progress.percent
          : null;
      setState({
        status: APP_UPDATE_STATUS.downloading,
        percent: raw == null ? null : Math.min(100, Math.max(0, Math.round(raw))),
        error: null,
      });
    });
    updater.on("update-downloaded", (info) => {
      setState({
        status: APP_UPDATE_STATUS.downloaded,
        percent: null,
        error: null,
        ...describeInfo(info),
      });
    });
    updater.on("error", (err) => {
      setState({
        status: APP_UPDATE_STATUS.error,
        percent: null,
        error: err instanceof Error ? err.message : String(err ?? ""),
      });
    });
    return updater;
  };

  const updater = async () => {
    if (isDisabled()) {
      setState({ status: APP_UPDATE_STATUS.unsupported, version: null, percent: null, error: null });
      return null;
    }
    if (!updaterPromise) {
      updaterPromise = loadUpdater()
        .then((loaded) => {
          if (!loaded) {
            setState({
              status: APP_UPDATE_STATUS.unsupported,
              version: null,
              percent: null,
              error: null,
            });
            return null;
          }
          updaterInstance = wireUpdater(loaded);
          return updaterInstance;
        })
        .catch((e) => {
          // 加载态失败（如 electron-updater 缺失）不能缓存成 rejected promise：
          // 否则启动检查与 4 小时定时器都会产生未处理 rejection，且永远不再重试。
          updaterPromise = null;
          setState({
            status: APP_UPDATE_STATUS.error,
            percent: null,
            error: errorMessage(e),
          });
          return null;
        });
    }
    return updaterPromise;
  };

  return {
    /** @returns {AppUpdateUiState} 当前界面状态（渲染层初始拉取） */
    uiState: () => uiState,

    /** 后台静默检查（延迟检查/周期复查），不弹窗。永不 reject。 */
    async checkSilently() {
      // 下载中再检查会把 available 重新发一遍，药丸的百分比会短暂丢失；
      // 下载进度本身会继续推进，等下载结束后的下一轮再检查即可。
      if (uiState.status === APP_UPDATE_STATUS.downloading) {
        return;
      }
      let u = null;
      try {
        u = await updater();
      } catch (e) {
        setState({
          status: APP_UPDATE_STATUS.error,
          percent: null,
          error: errorMessage(e),
        });
        return;
      }
      if (!u) {
        return;
      }
      try {
        await u.checkForUpdates();
      } catch (e) {
        if (uiState.status !== APP_UPDATE_STATUS.error) {
          setState({
            status: APP_UPDATE_STATUS.error,
            percent: null,
            error: errorMessage(e),
          });
        }
      }
    },

    /**
     * 药丸点击时决定下一步动作（执行在 electron 胶水层）。
     * @returns {"install" | "progress" | "download" | "check"}
     */
    actionForClick() {
      switch (uiState.status) {
        case APP_UPDATE_STATUS.downloaded:
          return "install";
        case APP_UPDATE_STATUS.downloading:
          return "progress";
        case APP_UPDATE_STATUS.available:
          return "download";
        default:
          return "check";
      }
    },

    /**
     * available 态主动补触发下载（autoDownload 失效时的兜底）。
     * 注意 `downloadUpdate()` 返回的是**整个下载过程**的 promise：
     * 这里只负责启动，错误单独上报，绝不让 IPC/点击一直挂着。
     */
    async downloadNow() {
      let u = null;
      try {
        u = await updater();
      } catch (e) {
        setState({
          status: APP_UPDATE_STATUS.error,
          percent: null,
          error: errorMessage(e),
        });
        return false;
      }
      if (!u || typeof u.downloadUpdate !== "function") {
        return false;
      }
      try {
        const started = u.downloadUpdate();
        if (started && typeof started.catch === "function") {
          started.catch((e) => {
            setState({
              status: APP_UPDATE_STATUS.error,
              percent: null,
              error: errorMessage(e),
            });
          });
        }
        return true;
      } catch (e) {
        setState({
          status: APP_UPDATE_STATUS.error,
          percent: null,
          error: errorMessage(e),
        });
        return false;
      }
    },

    /** Cursor 的 "Restart to Update"：退出当前应用并安装已就绪的新版本；重复点击只装一次。 */
    installNow() {
      if (uiState.status !== APP_UPDATE_STATUS.downloaded || installStarted) {
        return false;
      }
      installStarted = true;
      try {
        updaterInstance?.quitAndInstall?.(false, true);
      } catch {
        // 安装启动失败：允许用户再点一次，不要永久卡在「已点过」。
        installStarted = false;
        return false;
      }
      return true;
    },
  };
}

/* ───────────────────────── Electron 胶水 ───────────────────────── */

/** 简单去抖：progress 事件很密集，广播给渲染层 每 400ms 一次足够（药丸只是文字变化）。 */
const BROADCAST_MIN_INTERVAL_MS = 400;

/** @type {ReturnType<typeof createAppUpdateController> | null} */
let controllerRef = null;
/** @type {AppUpdateUiState | null} */
let lastState = null;
let lastBroadcastAt = 0;

function appUpdateDisabled() {
  return (
    !appE() ||
    !appE().isPackaged ||
    process.env.LAWMIND_SKIP_AUTO_UPDATE === "1" ||
    process.env.LAWMIND_E2E === "1"
  );
}

/** 惰性取 electron `app`；不可用时返回 null（测试环境）。 */
function appE() {
  return globalThis.lawmindElectronAppRef ?? null;
}

function publish(state) {
  const prev = lastState;
  lastState = state;
  if (
    state.status === APP_UPDATE_STATUS.downloading &&
    prev?.status === APP_UPDATE_STATUS.downloading
  ) {
    if (state.updatedAt - lastBroadcastAt < BROADCAST_MIN_INTERVAL_MS) {
      return; // 已并入 lastState，窗口新开时拉全量
    }
  }
  lastBroadcastAt = state.updatedAt;
  void broadcastAppUpdateState(state);
}

async function broadcastAppUpdateState(state) {
  try {
    const { BrowserWindow } = await import("electron");
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) {
        continue;
      }
      win.webContents.send(APP_UPDATE_CHANNEL, state);
    }
  } catch {
    /* electron 未就绪（如纯测试环境）——忽略 */
  }
}

/** 单例控制器。 */
export function getAppUpdateController() {
  if (!controllerRef) {
    controllerRef = createAppUpdateController({
      loadUpdater: loadAppUpdater,
      isDisabled: appUpdateDisabled,
      publish,
    });
  }
  return controllerRef;
}

/**
 * 渲染层初始拉取（IPC `lawmind:get-app-update-state`）。
 * 控制器尚未初始化时给兜底态。
 */
export function getAppUpdateUiState() {
  if (controllerRef) {
    return controllerRef.uiState();
  }
  return {
    status: appUpdateDisabled() ? APP_UPDATE_STATUS.unsupported : APP_UPDATE_STATUS.idle,
    version: null,
    percent: null,
    error: null,
    updatedAt: 0,
  };
}

/** @returns {Promise<unknown>} 真实 updater；禁用/评测环境 resolve null */
export function loadAppUpdater() {
  if (appUpdateDisabled()) {
    return Promise.resolve(null);
  }
  return import("electron-updater").then(({ autoUpdater }) => {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    return autoUpdater;
  });
}

/* UI 确认 / 提示框由 app-menu 注册（main-process dialog），核心不 import electron。 */
let confirmInstallHandler = null;
let showProgressHandler = null;

/** 注入「重启并安装」确认框：`(state) => Promise<boolean>`。 */
export function setAppUpdateConfirmInstall(handler) {
  confirmInstallHandler = typeof handler === "function" ? handler : null;
}

/** 注入「下载进度」提示框（点药丸时的进度反馈）：`(state) => Promise<void>`。 */
export function setAppUpdateShowProgress(handler) {
  showProgressHandler = typeof handler === "function" ? handler : null;
}

/** 启动延迟静默检查（E2E / 显式关闭时跳过）。 */
export function scheduleStartupAppUpdateCheck({ delayMs = 12_000 } = {}) {
  if (process.env.LAWMIND_E2E === "1" || process.env.LAWMIND_SKIP_AUTO_UPDATE === "1") {
    return;
  }
  setTimeout(() => {
    void getAppUpdateController().checkSilently();
  }, delayMs);
}

/**
 * 「更新」药丸点击的完整行为（IPC `lawmind:app-update-action`）：
 * - downloaded → 确认后立即重启安装（Cursor 同款）；
 * - downloading → 进度提示框；
 * - available → 补触发下载（只启动，不等待下载完成）；
 * - 其它（idle/checking/error）→ 静默复查一次。
 * @param {ReturnType<typeof createAppUpdateController>} [controller] 测试可注入
 * @returns {Promise<{ ok: boolean; action: string }>}
 */
export async function runAppUpdateActionFromClick(controller = getAppUpdateController()) {
  const action = controller.actionForClick();
  if (action === "install") {
    const target = controller.uiState();
    const confirmed = confirmInstallHandler ? await confirmInstallHandler(target) : true;
    if (confirmed) {
      controller.installNow();
    }
    return { ok: true, action };
  }
  if (action === "progress") {
    if (showProgressHandler) {
      await showProgressHandler(controller.uiState());
    }
    return { ok: true, action };
  }
  if (action === "download") {
    await controller.downloadNow();
    return { ok: true, action };
  }
  await controller.checkSilently();
  return { ok: true, action };
}

/** 环境不可用的解释文案（对话框用）。 */
export function appUpdateUnsupportedReason() {
  if (process.env.LAWMIND_E2E === "1") {
    return "测试环境不提供应用内更新。";
  }
  if (!appE() || !appE().isPackaged) {
    return "这是开发版本，没有应用内更新。";
  }
  if (process.env.LAWMIND_SKIP_AUTO_UPDATE === "1") {
    return "应用内更新已关闭。请向管理员索取安装包。";
  }
  return "";
}

/** 供 E2E / 测试注入 electron `app` 引用（判 packaged 用）。 */
export function setAppUpdateElectronApp(appInstance) {
  globalThis.lawmindElectronAppRef = appInstance ?? null;
}
