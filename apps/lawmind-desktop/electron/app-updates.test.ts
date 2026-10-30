import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_STATUS,
  createAppUpdateController,
  runAppUpdateActionFromClick,
  setAppUpdateConfirmInstall,
  setAppUpdateShowProgress,
} from "./app-updates.mjs";

/** 假 updater：按 electron-updater 语义转发事件。 */
type FakeEvent =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

function fakeUpdater() {
  const handlers = new Map<FakeEvent, ((arg?: unknown) => void)[]>();
  const updater = {
    on: (event: FakeEvent, handler: (arg?: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    emit: (event: FakeEvent, arg?: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(arg);
      }
    },
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  return updater;
}

function makeHarness({
  disabled = false,
  loadUpdater,
}: {
  disabled?: boolean;
  loadUpdater?: () => Promise<ReturnType<typeof fakeUpdater> | null>;
} = {}) {
  const updater = fakeUpdater();
  const publish = vi.fn();
  const controller = createAppUpdateController({
    loadUpdater: loadUpdater ?? (async () => (disabled ? null : updater)),
    isDisabled: () => disabled,
    publish: publish as unknown as (uiState: unknown) => void,
  });
  return { controller, updater, publish };
}

/** 让出微任务队列一轮（假 updater 的 async mock 需要）。 */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  setAppUpdateConfirmInstall(null);
  setAppUpdateShowProgress(null);
});

describe("createAppUpdateController 状态机", () => {
  it("禁用环境（开发版/跳过/E2E）：初始 unsupported，不弹、不装", async () => {
    const { controller, updater } = makeHarness({ disabled: true });
    expect(controller.uiState().status).toBe(APP_UPDATE_STATUS.unsupported);
    await controller.checkSilently();
    expect(controller.uiState().status).toBe(APP_UPDATE_STATUS.unsupported);
    expect(controller.actionForClick()).toBe("check");
    expect(controller.installNow()).toBe(false);
    expect(await controller.downloadNow()).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("启用环境首次检查前是 idle（不是 unsupported）", () => {
    const { controller } = makeHarness();
    expect(controller.uiState().status).toBe(APP_UPDATE_STATUS.idle);
  });

  it("available → downloading(钳制) → downloaded（Cursor 同款链路）", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("checking-for-update");
    expect(controller.uiState().status).toBe(APP_UPDATE_STATUS.checking);

    updater.emit("update-available", { version: "0.4.3" });
    expect(controller.uiState()).toMatchObject({ status: "available", version: "0.4.3" });
    const availableState = controller.uiState();

    updater.emit("download-progress", { percent: 51.9 });
    expect(controller.uiState()).toMatchObject({ status: "downloading", percent: 52 });
    expect(controller.uiState().version).toBe("0.4.3");

    updater.emit("download-progress", { percent: 240 });
    expect(controller.uiState().percent).toBe(100);
    updater.emit("download-progress", { percent: -1 });
    expect(controller.uiState().percent).toBe(0);

    updater.emit("update-downloaded", { version: "0.4.3" });
    expect(controller.uiState()).toMatchObject({
      status: APP_UPDATE_STATUS.downloaded,
      version: "0.4.3",
      percent: null,
    });
    expect(availableState.status).toBe(APP_UPDATE_STATUS.available);
  });

  it("update-not-available → idle；error 事件 → error（wire 后事件才生效）", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently(); // 接线（真实生命周期：事件先于检查不会发生）
    updater.emit("checking-for-update");
    updater.emit("update-not-available");
    expect(controller.uiState()).toMatchObject({
      status: APP_UPDATE_STATUS.idle,
      version: null,
      percent: null,
    });
    updater.emit("error", new Error("network down"));
    expect(controller.uiState()).toMatchObject({ status: APP_UPDATE_STATUS.error, error: "network down" });
  });

  it("checkForUpdates 抛错 → error 且同一错误不重复发布", async () => {
    const { controller, updater, publish } = makeHarness();
    updater.checkForUpdates.mockImplementation(async () => {
      throw new Error("boom");
    });
    await controller.checkSilently();
    expect(controller.uiState()).toMatchObject({
      status: APP_UPDATE_STATUS.error,
      error: "boom",
    });
    const errorPublishes = publish.mock.calls.filter(
      ([state]) => (state as { status: string }).status === APP_UPDATE_STATUS.error,
    );
    expect(errorPublishes).toHaveLength(1);
    await controller.checkSilently();
    expect(
      publish.mock.calls.filter(
        ([state]) => (state as { status: string }).status === APP_UPDATE_STATUS.error,
      ),
    ).toHaveLength(1);
  });

  it("加载 updater 失败：不抛、置 error，下一轮可重试并恢复", async () => {
    const updater = fakeUpdater();
    let attempts = 0;
    const { controller } = makeHarness({
      loadUpdater: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("electron-updater missing");
        }
        return updater;
      },
    });
    // 关键：checkSilently 永不 reject（启动定时器是 void 调用，不能有未处理 rejection）。
    await expect(controller.checkSilently()).resolves.toBeUndefined();
    expect(controller.uiState()).toMatchObject({
      status: APP_UPDATE_STATUS.error,
      error: "electron-updater missing",
    });
    // rejected promise 不能被缓存：第二次重新加载并接线。
    await controller.checkSilently();
    expect(attempts).toBe(2);
    updater.emit("update-available", { version: "1.2.3" });
    expect(controller.uiState()).toMatchObject({ status: "available", version: "1.2.3" });
  });

  it("下载中再复查会跳过（不打断百分比）", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit("download-progress", { percent: 40 });
    await controller.checkSilently();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(controller.uiState()).toMatchObject({ status: "downloading", percent: 40 });
  });

  it("actionForClick 按状态分派 install/progress/download/check", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently(); // 接线
    expect(controller.actionForClick()).toBe("check");
    updater.emit("update-downloaded", { version: "9.9" });
    expect(controller.actionForClick()).toBe("install");
    updater.emit("download-progress", { percent: 5 });
    expect(controller.actionForClick()).toBe("progress");
    updater.emit("update-available", { version: "9.9" });
    expect(controller.actionForClick()).toBe("download");
    updater.emit("update-not-available");
    expect(controller.actionForClick()).toBe("check");
  });

  it("installNow 只在就绪态生效，且重复点击只装一次", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently(); // 接线
    updater.emit("update-available", { version: "9.9" });
    expect(controller.installNow()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-downloaded", { version: "9.9" });
    expect(controller.installNow()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(controller.installNow()).toBe(false);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("installNow 失败重置：再次点击可重试", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently(); // 接线
    updater.emit("update-downloaded", { version: "1.0" });
    updater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error("cannot quit");
    });
    expect(controller.installNow()).toBe(false);
    updater.quitAndInstall.mockImplementation(() => undefined);
    expect(controller.installNow()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it("downloadNow 只启动下载、不等待整段下载完成", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("update-available", { version: "9.9" });
    // 真实 electron-updater 的 downloadUpdate() 返回整个下载过程的 promise。
    updater.downloadUpdate.mockImplementation(() => new Promise(() => {}));
    const result = await Promise.race([
      controller.downloadNow(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    expect(result).toBe(true);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("downloadNow 的异步失败会落到 error 态", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("update-available", { version: "9.9" });
    updater.downloadUpdate.mockImplementation(() => Promise.reject(new Error("disk full")));
    expect(await controller.downloadNow()).toBe(true);
    await flushMicrotasks();
    expect(controller.uiState()).toMatchObject({
      status: APP_UPDATE_STATUS.error,
      error: "disk full",
    });
  });
});

describe("runAppUpdateActionFromClick 分派", () => {
  it("就绪态确认后安装；取消则不安装", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("update-downloaded", { version: "2.0.0" });

    const confirm = vi.fn(async () => false);
    setAppUpdateConfirmInstall(confirm);
    expect(await runAppUpdateActionFromClick(controller)).toEqual({ ok: true, action: "install" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    setAppUpdateConfirmInstall(async () => true);
    await runAppUpdateActionFromClick(controller);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("下载中给进度提示，不重新检查", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("download-progress", { percent: 33 });
    const showProgress = vi.fn(async () => undefined);
    setAppUpdateShowProgress(showProgress);
    const result = await runAppUpdateActionFromClick(controller);
    expect(result.action).toBe("progress");
    expect(showProgress).toHaveBeenCalledWith(expect.objectContaining({ percent: 33 }));
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("available 时补触发下载", async () => {
    const { controller, updater } = makeHarness();
    await controller.checkSilently();
    updater.emit("update-available", { version: "3.0.0" });
    const result = await runAppUpdateActionFromClick(controller);
    expect(result.action).toBe("download");
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("静默态点击 = 静默复查", async () => {
    const { controller, updater } = makeHarness();
    const result = await runAppUpdateActionFromClick(controller);
    expect(result.action).toBe("check");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
