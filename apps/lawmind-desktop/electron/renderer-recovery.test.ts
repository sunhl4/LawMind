/**
 * Unit tests for renderer recovery helpers.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  app: { on: vi.fn() },
}));

describe("renderer-recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("retries load on did-fail-load and ignores ERR_ABORTED", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const contents = {
      on: (event: string, fn: (...args: unknown[]) => void) => {
        handlers.set(event, fn);
      },
      loadURL: vi.fn(async () => undefined),
    };
    const win = {
      isDestroyed: () => false,
      webContents: contents,
    };
    const reload = vi.fn(async () => undefined);
    const mod = await import("./renderer-recovery.mjs");
    mod.installRendererRecovery(win, reload);

    handlers.get("did-fail-load")?.({}, -3, "aborted", "http://127.0.0.1:5174/", true);
    expect(reload).not.toHaveBeenCalled();

    vi.useFakeTimers();
    handlers.get("did-fail-load")?.({}, -102, "CONNECTION_REFUSED", "http://127.0.0.1:5174/", true);
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
