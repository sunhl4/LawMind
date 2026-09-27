/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindArchiveOrganizePage } from "./LawmindArchiveOrganizePage";

describe("LawmindArchiveOrganizePage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it("shows suggested matters in lawyer language and hides scan internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            roots: [{ id: "r1", absPath: "/Users/a/卷宗/甲案", label: "甲案" }],
            latest: {
              stats: {
                cataloged: 4,
                messyFiles: 2,
                habitsQueued: 1,
                truncated: true,
                incremental: true,
                filesUnchanged: 9,
                filesChanged: 1,
              },
            },
            plan: {
              createMatters: [{ label: "甲案", count: 2 }],
              intoMatters: [{ matterId: "m-old", displayName: "旧案", count: 1 }],
              library: [{ kind: "other", label: "其他", count: 2 }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await act(async () => {
      root.render(<LawmindArchiveOrganizePage apiBase="http://127.0.0.1:8765" onBack={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("整理电脑上的资料");
    expect(host.textContent).toContain("甲案");
    expect(host.textContent).toContain("按勾选整理");
    expect(host.textContent).toContain("不发给模型");
    expect(host.textContent).toContain("桌面、文稿和下载");
    expect(host.textContent).toContain("新建案件");
    expect(host.textContent).toContain("收进已有案件");
    expect(host.textContent).toContain("一般资料");
    expect(host.textContent).toContain("甲案");
    expect(host.textContent).toContain("旧案");
    expect(host.textContent).toContain("其他");
    expect(host.textContent).toContain("等你确认后才记住");
    expect(host.textContent).toContain("前面一部分");
    expect(host.textContent).not.toContain("整理夹");
    expect(host.textContent).not.toContain("未变");
    expect(host.textContent).not.toContain("截断");
    expect(host.querySelector('[data-testid="lm-archive-organize-path"]')).toBeNull();
  });
});
