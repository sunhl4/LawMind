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

  it("shows execution-surface inventory when health returns lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            executionSurface: {
              lines: [
                "执行面：持久 6 项（卷宗/会话/草稿/常设工作等）不可当缓存清。",
                "执行面：凭据 3 项在工作区外或加密文件，助手不得当普通材料读。",
              ],
            },
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
    expect(host.querySelector("[data-testid='lm-workspace-execution-surface']")).toBeTruthy();
    expect(host.textContent).toContain("本机哪些不能丢");
    expect(host.textContent).toContain("不可当缓存清");
  });

  it("shows the prompt-budget line only when the budget health warns (P1-b)", async () => {
    const payload = (status: "ok" | "warn") => ({
      ok: true,
      doctor: {
        searchIndex: { ready: true, stale: false },
        matterConsistency: { ok: true },
        promptBudget: { turns: 12, status },
        promptBudgetLine:
          status === "warn"
            ? "提示词预算：全部 12 回合有告警 — 1 回合有片段被预算丢弃（共 2 个：protocol×1）。"
            : "提示词预算：全部 12 回合无技能/协议丢失，水位均值 38%（峰值 53%）。",
      },
    });

    // Behavior depends on the loaded health payload, so each state gets a
    // fresh mount (the effect only refetches when `apiBase` changes).
    const renderPayload = async (status: "ok" | "warn") => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(payload(status)), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      );
      act(() => {
        root.unmount();
      });
      root = createRoot(host);
      await act(async () => {
        root.render(<LawmindSettingsWorkspaceCare apiBase="http://127.0.0.1:8765" />);
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await renderPayload("ok");
    expect(host.querySelector("[data-testid='lm-workspace-prompt-budget']")).toBeNull();
    expect(host.textContent).not.toContain("提示词预算");

    await renderPayload("warn");
    expect(host.querySelector("[data-testid='lm-workspace-prompt-budget']")).toBeTruthy();
    expect(host.textContent).toContain("对话上下文");
    expect(host.textContent).toContain("protocol×1");
  });
});
