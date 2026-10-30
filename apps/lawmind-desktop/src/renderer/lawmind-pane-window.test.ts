/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeWorkspacePaneWindow,
  openWorkspacePaneWindow,
  paneDetachDragExceeded,
  workspacePaneFromWindowKey,
  workspacePaneTitle,
  workspacePaneWindowKey,
} from "./lawmind-pane-window";

afterEach(() => {
  delete window.lawmindDesktop;
  vi.restoreAllMocks();
});

describe("lawmind-pane-window", () => {
  it("uses pane labels unless an explicit title is given", () => {
    expect(workspacePaneTitle("chat")).toBe("对话");
    expect(workspacePaneTitle("middle")).toBe("中栏");
    expect(workspacePaneTitle("middle", " 某案卷宗 ")).toBe("某案卷宗");
  });

  it("keys chat by session and middle by draft > file > matter", () => {
    expect(workspacePaneWindowKey({ pane: "chat", sessionId: " s-1 " })).toBe(
      "workspace-pane:chat:s-1",
    );
    expect(workspacePaneWindowKey({ pane: "chat" })).toBe("workspace-pane:chat:current");
    expect(
      workspacePaneWindowKey({
        pane: "middle",
        matterId: "m-1",
        draftTaskId: "d-1",
      }),
    ).toBe("workspace-pane:middle:d-1");
    expect(workspacePaneWindowKey({ pane: "middle", matterId: "m-1" })).toBe(
      "workspace-pane:middle:m-1",
    );
    expect(
      workspacePaneWindowKey({
        pane: "middle",
        relPath: " artifacts/a.docx ",
      }),
    ).toBe("workspace-pane:middle:workspace:artifacts/a.docx");
    // 文件比案件更具体：同一案件下两份文件必须能各开一个窗口。
    expect(
      workspacePaneWindowKey({
        pane: "middle",
        matterId: "m-1",
        relPath: "artifacts/a.docx",
        root: "workspace",
      }),
    ).toBe("workspace-pane:middle:workspace:artifacts/a.docx");
    expect(
      workspacePaneWindowKey({
        pane: "middle",
        root: "project",
        relPath: "artifacts/a.docx",
      }),
    ).toBe("workspace-pane:middle:project:artifacts/a.docx");
  });

  it("only treats pointer movement past the threshold as a drag-out", () => {
    expect(paneDetachDragExceeded({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
    expect(paneDetachDragExceeded({ x: 10, y: 10 }, { x: 80, y: 10 })).toBe(true);
  });

  it("maps aux window keys back to their pane", () => {
    expect(workspacePaneFromWindowKey("workspace-pane:chat:s-1")).toBe("chat");
    expect(workspacePaneFromWindowKey(" workspace-pane:middle:workspace:a.md ")).toBe("middle");
    expect(workspacePaneFromWindowKey("review-preview:t-1")).toBeNull();
    expect(workspacePaneFromWindowKey("")).toBeNull();
  });

  it("returns a clear error when the Electron bridge is absent", async () => {
    const result = await openWorkspacePaneWindow({
      kind: "workspace-pane",
      pane: "chat",
    });
    expect(result.ok).toBe(false);
    expect(result.bridged).toBe(false);
    expect(result.error).toContain("桌面版");
  });

  it("forwards the route to the main process and returns its key", async () => {
    const payloads: unknown[] = [];
    window.lawmindDesktop = {
      openAuxWindow: async (payload) => {
        payloads.push(payload);
        return { ok: true, key: "workspace-pane:chat:s-1" };
      },
    } as typeof window.lawmindDesktop;

    const result = await openWorkspacePaneWindow({
      kind: "workspace-pane",
      pane: "chat",
      sessionId: "s-1",
    });

    expect(result).toEqual({
      ok: true,
      key: "workspace-pane:chat:s-1",
      focused: false,
      error: undefined,
      bridged: true,
    });
    expect(payloads).toEqual([
      { kind: "workspace-pane", pane: "chat", sessionId: "s-1" },
    ]);
  });

  it("closes the aux window through the Electron bridge", async () => {
    const closeWindow = vi.fn(async () => ({ ok: true }));
    window.lawmindDesktop = { closeWindow } as unknown as typeof window.lawmindDesktop;
    const windowClose = vi.spyOn(window, "close").mockImplementation(() => {});

    await expect(closeWorkspacePaneWindow()).resolves.toBe(true);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(windowClose).not.toHaveBeenCalled();
  });

  it("falls back to window.close() when the main process refuses", async () => {
    window.lawmindDesktop = {
      closeWindow: async () => ({ ok: false, error: "no_window" }),
    } as unknown as typeof window.lawmindDesktop;
    const windowClose = vi.spyOn(window, "close").mockImplementation(() => {});

    await expect(closeWorkspacePaneWindow()).resolves.toBe(false);
    expect(windowClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.close() without the bridge", async () => {
    const windowClose = vi.spyOn(window, "close").mockImplementation(() => {});

    await expect(closeWorkspacePaneWindow()).resolves.toBe(false);
    expect(windowClose).toHaveBeenCalledTimes(1);
  });

  it("reports success when window.close() really closes the window", async () => {
    const state = { closed: false };
    Object.defineProperty(window, "closed", {
      configurable: true,
      get: () => state.closed,
    });
    vi.spyOn(window, "close").mockImplementation(() => {
      state.closed = true;
    });
    try {
      await expect(closeWorkspacePaneWindow()).resolves.toBe(true);
    } finally {
      // Restore jsdom's prototype getter for later tests.
      // @ts-expect-error -- shadowed own property, not part of the Window type
      delete window.closed;
    }
  });
});
