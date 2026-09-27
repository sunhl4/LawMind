/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAcceptanceSheet } from "../../../../src/lawmind/acceptance-sheet/model.ts";
import type { ResearchBundle } from "../../../../src/lawmind/types.ts";
import { LawmindAcceptanceSheet } from "./LawmindAcceptanceSheet";
import { useAcceptancePaneStore } from "./stores/acceptance-pane-store";

const { apiGetJson, apiSendJson, fetchApi, fetchWithLoopbackAuthRetry } = vi.hoisted(() => {
  const fetchApi = vi.fn();
  const fetchWithLoopbackAuthRetry = vi.fn(
    async (base: string, run: (nextBase: string) => Promise<Response>) => ({
      response: await run(base),
      apiBase: base,
    }),
  );
  return {
    apiGetJson: vi.fn(),
    apiSendJson: vi.fn(),
    fetchApi,
    fetchWithLoopbackAuthRetry,
  };
});

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  fetchApi: (...args: unknown[]) => fetchApi(...args),
  fetchWithLoopbackAuthRetry: (base: string, run: (nextBase: string) => Promise<Response>) =>
    fetchWithLoopbackAuthRetry(base, run),
}));

const bundle: ResearchBundle = {
  taskId: "task-1",
  query: "违约金",
  sources: [
    {
      id: "src-1",
      title: "采购合同",
      kind: "contract",
      citation: "第 8.2 条",
      url: "cases/m1/采购合同.pdf",
      excerpt: "不超过百分之二十",
    },
  ],
  claims: [
    {
      text: "违约金为合同总额的百分之二十。",
      sourceIds: ["src-1"],
      confidence: 0.9,
      model: "legal",
      pin: { clause: "第 8.2 条", page: "12", quote: "不超过百分之二十" },
    },
    { text: "这句没有出处。", sourceIds: [], confidence: 0.99, model: "general" },
  ],
  riskFlags: [],
  missingItems: ["未见实际损失"],
  requiresReview: true,
  completedAt: "2026-09-27T00:00:00.000Z",
};

const sheet = buildAcceptanceSheet({
  taskId: "task-1",
  bundle,
  draft: {
    taskId: "task-1",
    title: "采购合同审查备忘",
    matterId: "m1",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "建议把违约金写成可调整。",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-09-27T00:00:00.000Z",
  },
});


describe("LawmindAcceptanceSheet", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAcceptancePaneStore.getState().resetForTest();
    apiGetJson.mockReset();
    apiSendJson.mockReset();
    apiGetJson.mockResolvedValue({ ok: true, sheet });
    apiSendJson.mockImplementation(async (_base: string, _path: string, _method: string, body: { mark?: string }) => ({
      ok: true,
      sheet: {
        ...sheet,
        claims: sheet?.claims.map((claim) => (body.mark ? { ...claim, mark: body.mark } : claim)),
      },
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  async function renderSheet(extra?: { onOpenReview?: () => void; onTooStrong?: (text: string) => void }) {
    await act(async () => {
      root.render(
        <LawmindAcceptanceSheet
          apiBase="http://127.0.0.1:9"
          sessionId="sess-1"
          loading={false}
          messageCount={2}
          onActive={() => {}}
          onOpenReview={extra?.onOpenReview}
          onTooStrong={extra?.onTooStrong}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows only the sourced claim and opens 改稿", async () => {
    const onOpenReview = vi.fn();
    await renderSheet({ onOpenReview });
    expect(host.textContent).toContain("导语，还不能逐句采信。");
    expect(host.textContent).toContain("违约金为合同总额的百分之二十。");
    expect(host.textContent).not.toContain("这句没有出处。");
    expect(host.textContent).toContain("未见实际损失");
    const review = host.querySelector('[data-testid="lm-acceptance-review"]') as HTMLButtonElement;
    review.click();
    expect(onOpenReview).toHaveBeenCalledWith({ taskId: "task-1", matterId: "m1" });
  });

  it("records 采信 and sends a weaken instruction only after the mark is saved", async () => {
    const onTooStrong = vi.fn();
    await renderSheet({ onTooStrong });
    const accept = host.querySelector('[data-testid="lm-acceptance-accept"]') as HTMLButtonElement;
    await act(async () => {
      accept.click();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/drafts/task-1/acceptance-sheet",
      "POST",
      expect.objectContaining({ mark: "accepted" }),
    );
    const weaken = host.querySelector('[data-testid="lm-acceptance-weaken"]') as HTMLButtonElement;
    await act(async () => {
      weaken.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onTooStrong).toHaveBeenCalledWith(expect.stringContaining("改弱"));
    expect(onTooStrong).toHaveBeenCalledWith(expect.stringContaining("不要补充没有依据"));
    expect(host.textContent).toContain("已放到输入框，改完再发送。");
  });

  it("shows the named PDF page beside the claim", async () => {
    fetchApi.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }),
    });
    // eslint-disable-next-line typescript/unbound-method -- 保存后恢复，测试里立刻绑定调用
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:page");
    await renderSheet();
    const open = host.querySelector('[data-testid="lm-acceptance-page"]') as HTMLButtonElement;
    await act(async () => {
      open.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-acceptance-page-frame"]')?.textContent).toContain("第 12 页");
    const claim = host.querySelector('[data-testid="lm-acceptance-claim"]');
    expect(claim?.querySelector('[data-testid="lm-acceptance-page-frame"]')).toBeTruthy();
    expect(fetchApi).toHaveBeenCalledWith(
      expect.stringContaining("page=12"),
      { cache: "no-store" },
      expect.objectContaining({ tag: "acceptance-page" }),
    );
    URL.createObjectURL = original;
  });

  it("draws the page under the claim that asked for it", async () => {
    const shared = "cases/m1/采购合同.pdf";
    const two = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: {
        ...bundle,
        sources: [
          { ...bundle.sources[0], url: shared },
          {
            id: "src-2",
            title: "附件",
            kind: "contract",
            citation: "附件第 3 页",
            url: `${shared}#page=3`,
          },
        ],
        claims: [
          { ...bundle.claims[0], sourceIds: ["src-1"] },
          {
            text: "第二句看附件。",
            sourceIds: ["src-2"],
            confidence: 0.8,
            model: "legal",
          },
        ],
      },
    });
    apiGetJson.mockResolvedValue({ ok: true, sheet: two });
    fetchApi.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }),
    });
    // eslint-disable-next-line typescript/unbound-method -- 保存后恢复，测试里立刻绑定调用
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:page-2");
    await renderSheet();
    const buttons = host.querySelectorAll('[data-testid="lm-acceptance-page"]');
    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const claims = host.querySelectorAll('[data-testid="lm-acceptance-claim"]');
    expect(claims[0]?.querySelector('[data-testid="lm-acceptance-page-frame"]')).toBeNull();
    expect(claims[1]?.querySelector('[data-testid="lm-acceptance-page-frame"]')?.textContent).toContain(
      "第 3 页",
    );
    URL.createObjectURL = original;
  });

  it("opens the first page when the citation does not name one", async () => {
    const unpaged = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: {
        ...bundle,
        claims: [
          {
            ...bundle.claims[0],
            pin: { clause: "第 8.2 条", quote: "不超过百分之二十" },
          },
        ],
      },
    });
    apiGetJson.mockResolvedValue({ ok: true, sheet: unpaged });
    fetchApi.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }),
    });
    // eslint-disable-next-line typescript/unbound-method -- 保存后恢复，测试里立刻绑定调用
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:first");
    await renderSheet();
    const open = host.querySelector('[data-testid="lm-acceptance-page"]') as HTMLButtonElement;
    await act(async () => {
      open.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("出处未写页码，从第 1 页看起");
    expect(fetchApi).toHaveBeenCalledWith(
      expect.stringContaining("page=1"),
      expect.anything(),
      expect.anything(),
    );
    URL.createObjectURL = original;
  });

  it("closes and opens again without waiting for another message", async () => {
    const onYield = vi.fn();
    await renderSheet();
    await act(async () => {
      root.render(
        <LawmindAcceptanceSheet
          apiBase="http://127.0.0.1:9"
          sessionId="sess-1"
          loading={false}
          messageCount={2}
          onActive={() => {}}
          onYieldToEditor={onYield}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const files = host.querySelector('[data-testid="lm-acceptance-files"]') as HTMLButtonElement;
    await act(async () => {
      files.click();
    });
    expect(onYield).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-testid='lm-acceptance-sheet']")).toBeNull();
    await act(async () => {
      useAcceptancePaneStore.getState().openSheet();
    });
    expect(host.querySelector("[data-testid='lm-acceptance-sheet']")).not.toBeNull();
    const close = host.querySelector('[data-testid="lm-acceptance-close"]') as HTMLButtonElement;
    await act(async () => {
      close.click();
    });
    expect(host.querySelector("[data-testid='lm-acceptance-sheet']")).toBeNull();
    await act(async () => {
      useAcceptancePaneStore.getState().openSheet();
    });
    expect(host.querySelector("[data-testid='lm-acceptance-sheet']")).not.toBeNull();
  });

  it("says when the pdf is too large to draw", async () => {
    fetchApi.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "pdf_too_large" }),
    });
    await renderSheet();
    const open = host.querySelector('[data-testid="lm-acceptance-page"]') as HTMLButtonElement;
    await act(async () => {
      open.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("这份 PDF 太大");
  });

  it("does not open a file when both folders have the same path", async () => {
    const openWithSystem = vi.fn(async () => ({ ok: true }));
    window.lawmindDesktop = { openWithSystem } as unknown as Window["lawmindDesktop"];
    fetchApi.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "ambiguous_root" }),
    });
    await renderSheet();
    const open = [...host.querySelectorAll("button")].find((button) => button.textContent === "用本机打开");
    await act(async () => {
      open?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openWithSystem).not.toHaveBeenCalled();
    expect(host.textContent).toContain("都有这份文件");
    delete window.lawmindDesktop;
  });

  it("opens the only folder that has the file", async () => {
    const openWithSystem = vi.fn(async () => ({ ok: true }));
    window.lawmindDesktop = { openWithSystem } as unknown as Window["lawmindDesktop"];
    fetchApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, root: "project" }),
    });
    await renderSheet();
    const open = [...host.querySelectorAll("button")].find((button) => button.textContent === "用本机打开");
    await act(async () => {
      open?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openWithSystem).toHaveBeenCalledWith({
      root: "project",
      path: "cases/m1/采购合同.pdf",
    });
    delete window.lawmindDesktop;
  });

  it("shows a sourced chart on the sheet", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      sheet: {
        ...sheet,
        charts: [
          {
            id: "artifacts/charts/fee.json",
            title: "费用",
            specText: JSON.stringify({
              title: "费用",
              type: "bar",
              categories: ["合计"],
              series: [{ name: "额", values: [12] }],
              source: { path: "cases/m/费用.xlsx" },
            }),
            sourcePath: "cases/m/费用.xlsx",
          },
        ],
      },
    });
    await renderSheet();
    expect(host.querySelector("[data-testid='lm-analysis-chart']")).toBeTruthy();
    expect(host.textContent).toContain("费用");
    expect(host.textContent).toContain("只读");
    expect(host.textContent).toContain("cases/m/费用.xlsx");
  });
});
