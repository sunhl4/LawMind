/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WordSurfaceSnapshot } from "../../../../../src/lawmind/drafts/word-surface.ts";

const apiGetJson = vi.fn();
const apiSendJson = vi.fn();

vi.mock("../api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { LawmindWordRevisionSurface } from "./LawmindWordRevisionSurface";

const snapshot: WordSurfaceSnapshot = {
  fileName: "补充协议.docx",
  relPath: "cases/m/补充协议.docx",
  root: "workspace",
  taskId: "task-1",
  updatedAt: "2026-09-27T00:00:00.000Z",
  paragraphs: [
    {
      segments: [
        { kind: "text", text: "甲方应于" },
        { kind: "revision", hunkId: "h1", before: "十日", after: "五日" },
        { kind: "text", text: "内付款。" },
      ],
    },
  ],
  hunks: [
    {
      hunkId: "h1",
      before: "十日",
      after: "五日",
      status: "pending",
      sectionHeading: "付款",
      color: 0,
      placed: true,
    },
  ],
  blocks: [],
  summary: { pending: 1, accepted: 0, rejected: 0 },
};

describe("LawmindWordRevisionSurface", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    apiGetJson.mockReset();
    apiSendJson.mockReset();
  });

  it("shows the revision and accepts it", async () => {
    apiGetJson.mockResolvedValue({ ok: true, ...snapshot });
    apiSendJson.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindWordRevisionSurface
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="cases/m/补充协议.docx"
          fileName="补充协议.docx"
          onOpenWithSystem={() => undefined}
          onRevealSource={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("预览");
    expect(host.textContent).toContain("十日");
    expect(host.textContent).toContain("五日");
    const accept = host.querySelector("[data-testid='lm-word-accept-h1']");
    expect(accept).toBeTruthy();
    const exportButton = host.querySelector("[data-testid='lm-word-surface-export']");
    expect(exportButton).toBeInstanceOf(HTMLButtonElement);
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    expect(exportButton?.textContent).toContain("导出并覆盖审阅稿");
    await act(async () => {
      accept?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/drafts/task-1/redline/hunks/h1/resolve",
      "POST",
      { decision: "accept" },
    );
    root.unmount();
  });

  it("uses one color for the page and the rail, and the page follows a right-side edit", async () => {
    apiGetJson.mockResolvedValue({ ok: true, ...snapshot });
    apiSendJson.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindWordRevisionSurface
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="cases/m/补充协议.docx"
          fileName="补充协议.docx"
          onOpenWithSystem={() => undefined}
          onRevealSource={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const page = host.querySelector("[data-word-slot='page']");
    const rail = host.querySelector("[data-word-slot='rail']");
    expect(page?.getAttribute("data-rev-color")).toBe("0");
    expect(rail?.getAttribute("data-rev-color")).toBe(page?.getAttribute("data-rev-color"));
    expect(host.querySelector("[data-testid='lm-word-accept-h1']")).toBeTruthy();
    expect(host.querySelector("[data-testid='lm-word-reject-h1']")).toBeTruthy();
    const textarea = host.querySelector("textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect((textarea as HTMLTextAreaElement).value).toBe("五");
    await act(async () => {
      Reflect.set(textarea as HTMLTextAreaElement, "value", "三");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-word-slot='page'] ins")?.textContent).toBe("三");
    expect(host.querySelector("[data-word-slot='page']")?.getAttribute("data-rev-color")).toBe("0");
    await act(async () => {
      host
        .querySelector("[data-testid='lm-word-accept-h1']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9",
      "/api/word-surface/hunks/h1/revise",
      "POST",
      { taskId: "task-1", after: "三日" },
    );
    expect(apiSendJson).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9",
      "/api/drafts/task-1/redline/hunks/h1/resolve",
      "POST",
      { decision: "accept" },
    );
    root.unmount();
  });

  it("keeps accept, reject, and the text field after the hunk is accepted", async () => {
    apiSendJson.mockResolvedValue({ ok: true });
    apiGetJson.mockResolvedValue({
      ok: true,
      ...snapshot,
      summary: { pending: 0, accepted: 1, rejected: 0 },
      hunks: [{ ...snapshot.hunks[0], status: "accepted" as const }],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindWordRevisionSurface
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="cases/m/补充协议.docx"
          fileName="补充协议.docx"
          onOpenWithSystem={() => undefined}
          onRevealSource={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("textarea")).toBeNull();
    const fold = host.querySelector("[data-testid='lm-word-fold-h1']");
    expect(fold?.textContent).toContain("已接受");
    await act(async () => {
      fold?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const accept = host.querySelector("[data-testid='lm-word-accept-h1']");
    const reject = host.querySelector("[data-testid='lm-word-reject-h1']");
    expect(accept).toBeInstanceOf(HTMLButtonElement);
    expect(reject).toBeInstanceOf(HTMLButtonElement);
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    expect(accept?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("textarea")).toBeInstanceOf(HTMLTextAreaElement);
    await act(async () => {
      reject?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/drafts/task-1/redline/hunks/h1/resolve",
      "POST",
      { decision: "reject" },
    );
    root.unmount();
  });

  it("saves document edits with Control+S", async () => {
    apiGetJson.mockResolvedValue({ ok: true, ...snapshot });
    apiSendJson.mockResolvedValue({ ok: true, taskId: "task-1", removed: 0, updated: 1 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindWordRevisionSurface
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="cases/m/补充协议.docx"
          fileName="补充协议.docx"
          onOpenWithSystem={() => undefined}
          onRevealSource={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const box = host.querySelector("[data-baseline]");
    expect(box).toBeInstanceOf(HTMLElement);
    if (!(box instanceof HTMLElement)) {
      return;
    }
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/word-surface/sync",
      "POST",
      {
        root: "workspace",
        path: "cases/m/补充协议.docx",
        paragraphs: [{ baseline: "甲方应于十日内付款。", current: "甲方应于五日内付款。" }],
      },
    );
    root.unmount();
  });
});
