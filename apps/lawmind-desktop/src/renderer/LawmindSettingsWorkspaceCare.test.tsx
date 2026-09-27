/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsWorkspaceCare } from "./LawmindSettingsWorkspaceCare";

describe("LawmindSettingsWorkspaceCare", () => {
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

  it("offers rebuild without a status dashboard, and repair only when records disagree", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/health")) {
          return new Response(
            JSON.stringify({
              ok: true,
              doctor: {
                searchIndex: { ready: false, stale: true },
                matterConsistency: {
                  ok: false,
                  issueCount: 2,
                  issues: [{ matterId: "m1", code: "title_drift", message: "标题不一致" }],
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await act(async () => {
      root.render(<LawmindSettingsWorkspaceCare apiBase="http://127.0.0.1:8765" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("重建查找");
    expect(host.textContent).toContain("查找还没跟上这些材料");
    expect(host.textContent).toContain("2 个案件");
    expect(host.textContent).not.toContain("title_drift");
    expect(host.textContent).not.toContain("系统健康");
    expect(host.textContent).not.toContain("一次通过");
  });

  it("hides rebuild when search is already keeping up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            doctor: { searchIndex: { ready: true, stale: false }, matterConsistency: { ok: true } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await act(async () => {
      root.render(<LawmindSettingsWorkspaceCare apiBase="http://127.0.0.1:8765" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("重建查找");
    expect(host.textContent).not.toContain("重新整理");
  });
});
