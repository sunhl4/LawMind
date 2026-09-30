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
    expect(host.querySelector("[data-testid='lm-word-surface']")).toBeTruthy();
    const rail = host.querySelector<HTMLElement>(".lm-word-surface-rail");
    expect(host.querySelector("[data-testid='lm-word-surface-rail-split']")).toBeTruthy();
    expect(rail?.style.width).toBe("220px");
    expect(host.textContent).toContain("核对");
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
      // eslint-disable-next-line typescript/unbound-method -- 原型 setter，下一行以 textarea 为 this 调用
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(textarea, "三");
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

  it("paints a Word page: paper width, 宋体, and character indent", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      ...snapshot,
      page: {
        widthPx: 793.7,
        marginTopPx: 94.5,
        marginRightPx: 94.5,
        marginBottomPx: 94.5,
        marginLeftPx: 94.5,
        fontFamily: '"Songti SC", "STSong", SimSun, serif',
        fontSizePx: 16,
      },
      paragraphs: [
        {
          align: "both" as const,
          firstIndent: { unit: "em" as const, value: 2 },
          spaceAfter: { unit: "px" as const, value: 24 },
          line: { rule: "auto" as const, multiple: 1.5 },
          fontFamily: '"Songti SC", SimSun, serif',
          segments: snapshot.paragraphs[0]?.segments ?? [],
        },
      ],
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
    const page = host.querySelector(".lm-word-surface-page");
    expect(page).toBeInstanceOf(HTMLElement);
    if (!(page instanceof HTMLElement)) {
      return;
    }
    expect(page.style.width).toBe("793.7px");
    expect(page.style.paddingLeft).toBe("94.5px");
    expect(page.style.fontSize).toBe("16px");
    expect(page.style.fontFamily).toContain("Songti SC");
    const paragraph = host.querySelector(".lm-word-surface-p");
    expect(paragraph).toBeInstanceOf(HTMLElement);
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }
    expect(paragraph.style.textAlign).toBe("justify");
    expect(paragraph.style.textIndent).toBe("2em");
    expect(paragraph.style.marginBottom).toBe("24px");
    expect(paragraph.style.lineHeight).toBe("1.5");
    expect(paragraph.style.fontFamily).toContain("Songti SC");
    root.unmount();
  });

  it("right-click offers the folder and WPS, and Control+Z undoes", async () => {
    apiGetJson.mockResolvedValue({ ok: true, ...snapshot });
    const reveal = vi.fn();
    const wps = vi.fn();
    const commands: string[] = [];
    const previous = document.execCommand.bind(document);
    document.execCommand = ((command: string) => {
      commands.push(command);
      return true;
    }) as typeof document.execCommand;
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
          onOpenWithSystem={wps}
          onRevealSource={reveal}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const desk = host.querySelector(".lm-word-surface-desk");
    await act(async () => {
      desk?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }),
      );
    });
    const revealButton = host.querySelector<HTMLButtonElement>("[data-testid='lm-word-surface-reveal']");
    const wpsButton = host.querySelector<HTMLButtonElement>("[data-testid='lm-word-surface-wps']");
    expect(revealButton?.textContent).toContain("去本机文件所在目录");
    expect(wpsButton?.textContent).toContain("用本机应用打开");
    expect(wpsButton?.parentElement?.textContent).not.toContain("删除线");
    await act(async () => {
      revealButton?.click();
    });
    expect(reveal).toHaveBeenCalledOnce();
    const box = host.querySelector("[data-baseline]");
    await act(async () => {
      box?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    });
    expect(commands).toEqual(["undo"]);
    document.execCommand = previous;
    root.unmount();
  });
});
