/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PptxFileView } from "./PptxFileView";
import type { OpenFileTab } from "./file-workbench-types";

const apiGetJson = vi.fn();
const apiSendJson = vi.fn();
const fetchApi = vi.fn();
const fetchWithLoopbackAuthRetry = vi.fn();

vi.mock("../api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  fetchApi: (...args: unknown[]) => fetchApi(...args),
  fetchWithLoopbackAuthRetry: (...args: unknown[]) => fetchWithLoopbackAuthRetry(...args),
  errorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

function pptxTab(): OpenFileTab {
  return {
    id: "workspace:brief.pptx",
    root: "workspace",
    path: "artifacts/案件进展.pptx",
    name: "案件进展.pptx",
    kind: "pptx",
    content: "",
    savedContent: "",
    mtimeMs: 42,
  };
}

const visualBody = {
  ok: true as const,
  mode: "visual" as const,
  mtimeMs: 42,
  slideCount: 2,
  truncatedSlides: false,
  cacheKey: "abc",
  slides: [
    {
      index: 0,
      label: "1",
      title: "案件进展汇报",
      shapes: [
        {
          path: "/slide[1]/shape[@id=2]",
          slideIndex: 0,
          text: "案件进展汇报",
          isTitle: true,
        },
        {
          path: "/slide[1]/shape[@id=3]",
          slideIndex: 0,
          text: "争议焦点一",
          isTitle: false,
        },
      ],
    },
    {
      index: 1,
      label: "2",
      title: "时间线",
      shapes: [
        {
          path: "/slide[2]/shape[@id=2]",
          slideIndex: 1,
          text: "时间线",
          isTitle: true,
        },
      ],
    },
  ],
};

describe("PptxFileView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiGetJson.mockReset();
    apiSendJson.mockReset();
    fetchApi.mockReset();
    fetchWithLoopbackAuthRetry.mockReset();
    apiGetJson.mockResolvedValue(visualBody);
    fetchWithLoopbackAuthRetry.mockImplementation(async (_base: string, run: (b: string) => Promise<unknown>) =>
      run("http://127.0.0.1:9"),
    );
    fetchApi.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("loads visual slides, renders canvas, and edits shape text", async () => {
    await act(async () => {
      root.render(
        <PptxFileView
          apiBase="http://127.0.0.1:9"
          tab={pptxTab()}
          actions={{
            onRevealSource: () => undefined,
            onOpenWithSystem: () => undefined,
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGetJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      expect.stringContaining("/api/fs/pptx-preview?"),
    );
    expect(container.querySelector("[data-testid='lm-pptx-page']")?.textContent).toContain("1 / 2");
    expect(container.querySelector("[data-testid='lm-pptx-canvas']")).toBeTruthy();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='lm-pptx-edit-textarea']",
    );
    expect(textarea?.value).toContain("案件进展汇报");
    await act(async () => {
      if (!textarea) {
        return;
      }
      // eslint-disable-next-line typescript/unbound-method -- 原型 setter，下一行以 textarea 为 this 调用
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "新标题");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    apiSendJson.mockResolvedValue({ ok: true, applied: 1, mtimeMs: 99 });
    apiGetJson.mockResolvedValue({ ...visualBody, mtimeMs: 99 });
    const save = container.querySelector<HTMLButtonElement>("[data-testid='lm-pptx-save']");
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/fs/pptx-save",
      "POST",
      expect.objectContaining({
        path: "artifacts/案件进展.pptx",
        edits: [expect.objectContaining({ path: "/slide[1]/shape[@id=2]", text: "新标题" })],
      }),
    );
  });
});
