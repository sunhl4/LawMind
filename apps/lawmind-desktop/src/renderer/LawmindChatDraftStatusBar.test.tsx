/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatDraftStatusBar } from "./LawmindChatDraftStatusBar";

describe("LawmindChatDraftStatusBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/review")) {
          return new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        if (url.includes("/api/drafts/task-1")) {
          return new Response(
            JSON.stringify({
              ok: true,
              draft: { reviewStatus: "pending" },
              gateDecisions: [
                { gate: "lawyer_review", decision: "block", reason: "等待律师签批" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("fetches GET /api/drafts/:taskId not /review", async () => {
    await act(async () => {
      root.render(
        <LawmindChatDraftStatusBar
          apiBase="http://127.0.0.1:59999"
          linkedTaskId="task-1"
          assistantText="草稿已生成"
        />,
      );
    });
    await vi.waitFor(
      () => {
        expect(host.textContent).toContain("等待律师签批");
      },
      { timeout: 3000 },
    );
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const firstCall = fetchMock.mock.calls[0]?.[0];
    const calledUrl = typeof firstCall === "string" ? firstCall : "";
    expect(calledUrl).toContain("/api/drafts/task-1");
    expect(calledUrl).not.toContain("/review");
  });
});
