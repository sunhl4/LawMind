/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAutomationsPanel } from "./LawmindAutomationsPanel";
import { LawmindShellProviders } from "./app/LawmindShellContexts";

const EMPTY_SCHEDULE = { kind: "weekly", weekday: 1, hour: 9, minute: 0 };

function automationPayload(over: Record<string, unknown> = {}) {
  return {
    id: "auto-1",
    title: "合同续签盯梢",
    enabled: true,
    presetId: "renewal-monitor",
    matterId: "m1",
    schedule: EMPTY_SCHEDULE,
    nextRunAt: "2026-09-28T01:00:00.000Z",
    expectedResult: "一份续签提醒清单",
    approvalBoundary: "外发前必须问我",
    missingDataPolicy: "report_failure",
    notifyPolicy: "on_problem",
    ...over,
  };
}

const RUNS_PAYLOAD = {
  runs: [
    {
      runId: "run-new",
      trigger: "schedule",
      status: "blocked",
      startedAt: "2026-09-21T09:00:00.000Z",
      finishedAt: "2026-09-21T09:00:04.000Z",
      summary: "待你批准发信",
      notified: true,
    },
    {
      runId: "run-mid",
      trigger: "schedule",
      status: "failed",
      startedAt: "2026-09-21T08:00:00.000Z",
      finishedAt: "2026-09-21T08:00:03.000Z",
      errorCode: "mail_unconfigured",
      errorMessage: "邮箱未配置",
      notified: true,
    },
    {
      runId: "run-old",
      trigger: "schedule",
      status: "ok",
      startedAt: "2026-09-21T07:00:00.000Z",
      finishedAt: "2026-09-21T07:00:02.000Z",
      summary: "扫到 2 份即将到期合同",
      notified: false,
    },
  ],
  stats: {
    total: 3,
    okCount: 1,
    failedCount: 1,
    skippedCount: 0,
    blockedCount: 1,
    missingDataCount: 0,
  },
  promotion: { ready: false, message: "最近 3 次里有 1 次失败。", reasons: ["最近 3 次里有 1 次失败。"] },
};

let captured: Array<{ url: string; body?: unknown }> = [];

const fetchMock = vi.fn(async (input: unknown, init?: { body?: string; method?: string }) => {
  const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? "");
  captured.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
  let payload: unknown = { ok: true };
  if (url.includes("/api/automations/presets")) {
    payload = { ok: true, presets: [] };
  } else if (/\/api\/automations\/[^/]+\/runs/.test(url)) {
    payload = { ok: true, ...RUNS_PAYLOAD };
  } else if (url.endsWith("/api/automations")) {
    payload = { ok: true, automations: [automationPayload()], inbox: [] };
  } else if (url.includes("/api/matters")) {
    payload = { ok: true, matters: [] };
  }
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
});

const props = {
  apiBase: "http://127.0.0.1:1234",
  matterId: "m1",
  matterOptions: [{ id: "m1", title: "奥看科技" }],
};

describe("LawmindAutomationsPanel 六确认与运行记录", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured = [];
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

  async function renderPanel(): Promise<void> {
    await act(async () => {
      root.render(
        // 行选中态存在 shell 上下文里；不套 provider 的话点击是 no-op，
        // 运行记录永远不会出现（那会让这个测试变成假绿）。
        <LawmindShellProviders
          navigation={{ mainView: "workspace", matterCockpitOpen: false, settingsOpen: false }}
          chatSession={{ selectedAssistantId: "", activeChatSessionId: undefined }}
        >
          <LawmindAutomationsPanel {...props} />
        </LawmindShellProviders>,
      );
    });
    for (let i = 0; i < 20; i += 1) {
      if (host.querySelector('[data-automation-id="auto-1"]')) {
        return;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function waitFor(testId: string): Promise<Element | null> {
    for (let i = 0; i < 30; i += 1) {
      const found = host.querySelector(`[data-testid="${testId}"]`);
      if (found) {
        return found;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
    return host.querySelector(`[data-testid="${testId}"]`);
  }

  it("shows the four confession fields with safe defaults preselected", async () => {
    await renderPanel();
    const fieldset = host.querySelector('[data-testid="lm-auto-confirmations"]');
    expect(fieldset).not.toBeNull();

    const missing = host.querySelector<HTMLSelectElement>('[data-testid="lm-auto-missing-data"]');
    // 默认如实报失败——与引擎的 report_failure 默认同向，绝不拿旧数据顶上。
    expect(missing?.value).toBe("report_failure");

    const notify = host.querySelector<HTMLSelectElement>('[data-testid="lm-auto-notify-policy"]');
    expect(notify?.value).toBe("on_problem");

    // 文本项必须由律师自己写，不能预填。
    const expected = host.querySelector<HTMLInputElement>('[data-testid="lm-auto-expected-result"]');
    expect(expected?.value).toBe("");
  });

  it("says out loud that failures still reach the lawyer regardless of the notify choice", async () => {
    await renderPanel();
    const fieldset = host.querySelector('[data-testid="lm-auto-confirmations"]');
    expect(fieldset?.textContent).toContain("一定会通知你");
  });

  it("loads and shows the run history for the focused automation", async () => {
    await renderPanel();
    const row = host.querySelector<HTMLElement>('[data-automation-id="auto-1"]');
    expect(row).not.toBeNull();
    await act(async () => {
      row?.click();
    });
    const runs = await waitFor("lm-auto-runs");
    expect(runs).not.toBeNull();
    // 三种结果用三种人话，不能都写成一个词。
    expect(runs?.textContent).toContain("停下来等你拍板");
    expect(runs?.textContent).toContain("没办成");
    expect(runs?.textContent).toContain("办完了");
    expect(runs?.textContent).toContain("邮箱未配置");
    expect(runs?.textContent).toContain("最近 3 次里有 1 次失败");
  });

  it("shows what was originally committed to, not just the outcome", async () => {
    await renderPanel();
    const row = host.querySelector<HTMLElement>('[data-automation-id="auto-1"]');
    await act(async () => {
      row?.click();
    });
    const runs = await waitFor("lm-auto-runs");
    expect(runs?.textContent).toContain("一份续签提醒清单");
    expect(runs?.textContent).toContain("外发前必须问我");
  });

  it("refuses to create without the two written confirmations, and names what is missing", async () => {
    await renderPanel();
    const buttons = [...host.querySelectorAll("button")];
    const createBtn = buttons.find((b) => b.textContent?.includes("用所选模板创建"));
    expect(createBtn).toBeTruthy();
    await act(async () => {
      createBtn?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // 既不该发请求，也该说清缺哪两项。
    expect(captured.some((c) => c.url.endsWith("/api/automations") && c.body)).toBe(false);
    expect(host.textContent).toContain("办完是什么样");
    expect(host.textContent).toContain("哪些事必须先问我");
  });

  it("sends all four confirmations when the lawyer filled them in", async () => {
    await renderPanel();

    // React 受控输入：必须走原生 value setter，直接改 `.value` 不会触发 onChange。
    const typeInto = (testId: string, text: string) => {
      const el = host.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
      if (!el) {
        throw new Error(`missing input ${testId}`);
      }
      // React 受控输入：必须走原型上的原生 value setter，直接改 `el.value` 不会触发 onChange。
      // 这里取的是方法引用再 `.call`，所以对 unbound-method 定向豁免——本仓没有
      // @testing-library，这是无依赖下测受控输入的标准手法。
      // eslint-disable-next-line typescript/unbound-method -- 立即以 el 为 this 调用，不构成未绑定使用
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set as ((this: HTMLInputElement, value: string) => void) | undefined;
      setter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      typeInto("lm-auto-expected-result", "一份续签提醒清单");
      typeInto("lm-auto-approval-boundary", "外发前必须问我");
    });

    const createBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("用所选模板创建"),
    );
    await act(async () => {
      createBtn?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const post = captured.find((c) => c.url.endsWith("/api/automations") && c.body);
    expect(post).toBeTruthy();
    expect(post?.body).toMatchObject({
      matterId: "m1",
      expectedResult: "一份续签提醒清单",
      approvalBoundary: "外发前必须问我",
      missingDataPolicy: "report_failure",
      notifyPolicy: "on_problem",
    });
  });
});
