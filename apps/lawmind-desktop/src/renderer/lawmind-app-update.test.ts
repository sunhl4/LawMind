/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLawmindAppUpdatePayload,
  getLawmindAppUpdateSnapshot,
  isLawmindAppUpdatePillVisible,
  lawmindAppUpdatePillLabel,
  runLawmindAppUpdateAction,
  subscribeLawmindAppUpdate,
} from "./lawmind-app-update";

/**
 * store 的 `updatedAt` 是单调合并的；测试共用一个模块实例，
 * 用一个只增不减的时钟，避免用例之间因时间戳顺序互相丢弃推送。
 */
let clock = 0;
function nextClock(): number {
  clock += 1;
  return clock;
}

function apply(payload: Record<string, unknown>): void {
  applyLawmindAppUpdatePayload({ ...payload, updatedAt: nextClock() });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyLawmindAppUpdatePayload", () => {
  it("available / downloading / downloaded 三种状态决定药丸可见性与文案", () => {
    apply({ status: "available", version: "0.4.2" });
    expect(isLawmindAppUpdatePillVisible(getLawmindAppUpdateSnapshot())).toBe(true);
    expect(lawmindAppUpdatePillLabel(getLawmindAppUpdateSnapshot())).toBe("更新");

    apply({ status: "downloading", percent: 41.7 });
    expect(getLawmindAppUpdateSnapshot()).toMatchObject({
      status: "downloading",
      percent: 42,
      version: "0.4.2",
    });
    expect(lawmindAppUpdatePillLabel(getLawmindAppUpdateSnapshot())).toBe("更新 42%");

    apply({ status: "downloaded", percent: null });
    expect(getLawmindAppUpdateSnapshot()).toMatchObject({ status: "downloaded", percent: null });
    expect(lawmindAppUpdatePillLabel(getLawmindAppUpdateSnapshot())).toBe("更新");
  });

  it("percent 钳制到 0..100；缺省时为 null", () => {
    apply({ status: "downloading", percent: 120 });
    expect(getLawmindAppUpdateSnapshot().percent).toBe(100);
    apply({ status: "downloading", percent: -3 });
    expect(getLawmindAppUpdateSnapshot().percent).toBe(0);
    apply({ status: "downloading" });
    expect(getLawmindAppUpdateSnapshot().percent).toBeNull();
  });

  it("version：缺省沿用上一次，显式 null 清空", () => {
    apply({ status: "available", version: "1.0.0" });
    apply({ status: "downloading" }); // 进度事件不带 version
    expect(getLawmindAppUpdateSnapshot().version).toBe("1.0.0");
    apply({ status: "idle", version: null });
    expect(getLawmindAppUpdateSnapshot().version).toBeNull();
  });

  it("拒绝未知状态与非对象载荷，快照保持不变", () => {
    apply({ status: "downloaded", version: "9.9.9" });
    const before = getLawmindAppUpdateSnapshot();
    applyLawmindAppUpdatePayload({ status: "surprise", updatedAt: nextClock() });
    applyLawmindAppUpdatePayload(null);
    applyLawmindAppUpdatePayload("downloaded");
    expect(getLawmindAppUpdateSnapshot()).toBe(before);
  });

  it("丢弃更新时间更早的推送，避免迟到的初始拉取把状态回退", () => {
    apply({ status: "downloaded", version: "0.4.3" });
    const before = getLawmindAppUpdateSnapshot();
    applyLawmindAppUpdatePayload({ status: "checking", updatedAt: before.updatedAt - 1 });
    expect(getLawmindAppUpdateSnapshot()).toBe(before);
  });

  it("idle / unsupported / error / checking 都不显示药丸", () => {
    for (const status of ["idle", "unsupported", "error", "checking"] as const) {
      apply({ status });
      expect(isLawmindAppUpdatePillVisible(getLawmindAppUpdateSnapshot())).toBe(false);
    }
  });

  it("订阅在状态变化时触发，取消后不再触发", () => {
    const seen: string[] = [];
    const unsub = subscribeLawmindAppUpdate(() => {
      seen.push(getLawmindAppUpdateSnapshot().status);
    });
    apply({ status: "downloaded" });
    unsub();
    apply({ status: "idle" });
    expect(seen).toEqual(["downloaded"]);
    expect(getLawmindAppUpdateSnapshot().status).toBe("idle");
  });
});

describe("runLawmindAppUpdateAction", () => {
  it("委托给 preload 暴露的动作，并恢复 window 桩", async () => {
    const action = vi.fn(async () => ({ ok: true, action: "install" }));
    const prev = window.lawmindDesktop;
    try {
      window.lawmindDesktop = { ...prev, runAppUpdateAction: action } as typeof window.lawmindDesktop;
      await runLawmindAppUpdateAction();
      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      window.lawmindDesktop = prev;
    }
  });
});
