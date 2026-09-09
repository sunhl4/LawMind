/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LawmindTaskDrawer } from "./LawmindTaskDrawer";

let capturedOnMessage: ((msg: { type: string; data: unknown }) => void) | null = null;
let capturedOnOpen: (() => void) | null = null;
let capturedOnError: (() => void) | null = null;

vi.mock("./useSseSubscription", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./useSseSubscription")>();
  return {
    ...mod,
    useSseSubscription: vi.fn(
      (
        _apiBase: string,
        _types: string[],
        onMessage: (msg: { type: string; data: unknown }) => void,
        opts?: { onOpen?: () => void; onError?: () => void; onClose?: () => void },
      ) => {
        capturedOnMessage = onMessage;
        capturedOnOpen = opts?.onOpen ?? null;
        capturedOnError = opts?.onError ?? null;
        return { state: "open", connected: true, error: false };
      },
    ),
  };
});

vi.mock("./lawmind-job-stream", () => ({
  openJobEventStream: vi.fn(() => () => {}),
}));

const fetchMock = vi.fn(async () =>
  Promise.resolve({
    ok: true,
    text: async () =>
      JSON.stringify({
        ok: true,
        jobs: [],
        toolApprovals: [],
        delegations: [],
      }),
    json: async () => ({
      ok: true,
      jobs: [],
      toolApprovals: [],
      delegations: [],
    }),
  } as unknown as Response),
);

describe("LawmindTaskDrawer SSE 轮询回退", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    capturedOnMessage = null;
    capturedOnOpen = null;
    capturedOnError = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("SSE 连接成功时只触发初始刷新，不启动 8 秒轮询", async () => {
    await act(async () => {
      root.render(<LawmindTaskDrawer open={true} onClose={() => {}} apiBase="http://127.0.0.1:9999" />);
    });
    await act(async () => {
      capturedOnOpen?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    // 初始打开触发 3 次 fetch（jobs / action-summary / delegations）。
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("SSE 收到事件时触发刷新", async () => {
    await act(async () => {
      root.render(<LawmindTaskDrawer open={true} onClose={() => {}} apiBase="http://127.0.0.1:9999" />);
    });
    await act(async () => {
      capturedOnMessage?.({ type: "task:update", data: {} });
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    // 初始 3 次 + 事件触发的 3 次。
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("SSE 断开时恢复 8 秒轮询", async () => {
    await act(async () => {
      root.render(<LawmindTaskDrawer open={true} onClose={() => {}} apiBase="http://127.0.0.1:9999" />);
    });
    await act(async () => {
      capturedOnError?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    // 初始 3 次 + 8 秒轮询 3 次。
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
