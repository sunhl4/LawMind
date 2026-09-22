/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";

/** `/api/daemon` 的响应由每个用例指定；其余 GET 一律给空壳，避免子面板报错。 */
let daemonPayload: Record<string, unknown> = {};
let daemonLogPayload: { lines: string[]; exists: boolean } = { lines: [], exists: false };
const fetchMock = vi.fn(async (input: unknown) => {
  const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? "");
  const body = url.includes("/api/daemon/log")
    ? { ok: true, log: daemonLogPayload }
    : url.includes("/api/daemon")
      ? { ok: true, daemon: daemonPayload }
      : { ok: true };
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
});

const props = {
  config: {
    workspaceDir: "/tmp/lm-ws",
    projectDir: null,
    retrievalMode: "single" as const,
  },
  apiBase: "http://127.0.0.1:1234",
  workspaceLabel: "工作区",
  projectDir: null,
  onPickProject: () => {},
  onClearProject: () => {},
};

describe("设置页「关桌面后继续办件」回执", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  async function renderWith(payload: Record<string, unknown>): Promise<void> {
    daemonPayload = payload;
    await act(async () => {
      root.render(<LawmindSettingsWorkspace {...props} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** 轮询到条件成立，避免依赖固定的 microtask 次数。 */
  async function waitForRecap(): Promise<Element | null> {
    for (let i = 0; i < 20; i += 1) {
      const found = host.querySelector('[data-testid="lm-daemon-recap"]');
      if (found) {
        return found;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
    return host.querySelector('[data-testid="lm-daemon-recap"]');
  }

  it("stays quiet when the backend reports nothing happened", async () => {
    await renderWith({
      enabled: true,
      running: true,
      restartCount: 0,
      supervisionGaveUp: false,
      recap: null,
    });
    expect(host.querySelector('[data-testid="lm-daemon-recap"]')).toBeNull();
  });

  it("tells the lawyer what happened while they were away", async () => {
    await renderWith({
      enabled: true,
      running: true,
      restartCount: 2,
      lastExitClass: "crashed",
      recap: {
        headline: "后台办件中断过，已自动恢复",
        details: ["期间后台办件中断过 2 次，已自动重启。"],
      },
    });
    const recap = await waitForRecap();
    expect(recap).not.toBeNull();
    expect(recap?.textContent).toContain("后台办件中断过，已自动恢复");
    expect(recap?.textContent).toContain("中断过 2 次");
  });

  it("escalates tone when retries were exhausted", async () => {
    await renderWith({
      enabled: true,
      running: false,
      restartCount: 5,
      supervisionGaveUp: true,
      recap: {
        headline: "后台办件已停止重试",
        details: ["后台办件连续失败 5 次后已停止重试。这段时间的自动办件没有运行。"],
      },
    });
    const recap = await waitForRecap();
    expect(recap?.className).toContain("lm-callout-danger");
    expect(recap?.textContent).toContain("没有运行");
  });

  it("uses the warning tone for a stalled loop", async () => {
    await renderWith({
      enabled: true,
      running: true,
      heartbeatStale: true,
      recap: {
        headline: "后台办件可能卡住了",
        details: ["后台办件还开着，但已经超过一分钟没有动静，可能卡住了。"],
      },
    });
    const recap = await waitForRecap();
    expect(recap?.className).toContain("lm-callout-warn");
  });

  it("renders the recap as a status region so screen readers announce it", async () => {
    await renderWith({
      enabled: true,
      running: true,
      restartCount: 1,
      recap: { headline: "后台办件中断过，已自动恢复", details: ["已自动重启。"] },
    });
    const recap = await waitForRecap();
    expect(recap?.getAttribute("role")).toBe("status");
  });
describe("后台办件日志的可见面", () => {
  it("reads the log only when the lawyer expands it", async () => {
    daemonPayload = { enabled: true, running: true, recap: null };
    daemonLogPayload = { lines: ["[lawmindd] 启动 pid=1"], exists: true };
    await act(async () => {
      root.render(<LawmindSettingsWorkspace {...props} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const logCallsBeforeExpand = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/daemon/log"),
    );
    // 打开设置不该顺带读盘：日志是排障材料，按需才取。
    expect(logCallsBeforeExpand).toHaveLength(0);

    const details = host.querySelector('[data-testid="lm-daemon-log"]');
    expect(details).not.toBeNull();
    await act(async () => {
      details?.setAttribute("open", "");
      details?.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    for (let i = 0; i < 20; i += 1) {
      if (host.querySelector('[data-testid="lm-daemon-log-lines"]')) {
        break;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
    const pre = host.querySelector('[data-testid="lm-daemon-log-lines"]');
    expect(pre?.textContent).toContain("[lawmindd] 启动");
  });

  it("says there is no log yet rather than showing an empty box", async () => {
    daemonPayload = { enabled: true, running: false, recap: null };
    daemonLogPayload = { lines: [], exists: false };
    await act(async () => {
      root.render(<LawmindSettingsWorkspace {...props} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const details = host.querySelector('[data-testid="lm-daemon-log"]');
    await act(async () => {
      details?.setAttribute("open", "");
      details?.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    for (let i = 0; i < 20; i += 1) {
      if (host.textContent?.includes("还没有日志")) {
        break;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
    // 「还没跑过」与「跑过但没事」是两句不同的话。
    expect(host.textContent).toContain("还没有日志");
  });
});
});
