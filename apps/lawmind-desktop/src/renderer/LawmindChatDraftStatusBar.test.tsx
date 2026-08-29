/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatDraftStatusBar } from "./LawmindChatDraftStatusBar";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async () => ({
    ok: true,
    draft: { reviewStatus: "pending", matterId: "m1" },
    gateDecisions: [],
  })),
}));

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("LawmindChatDraftStatusBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
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

  it("pending draft offers 打开结果", async () => {
    await act(async () => {
      root.render(
        <LawmindChatDraftStatusBar
          apiBase="http://127.0.0.1:1"
          linkedTaskId="t1"
          assistantText="审查意见已拟好，请律师签批。"
          onOpenReview={vi.fn()}
          onOpenNeedsDecisionDesk={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-draft-status-signoff"]')?.textContent).toContain("打开结果");
    expect(host.querySelector('[data-testid="lm-draft-status-open-review"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-draft-status-open-artifact"]')).toBeNull();
  });

  it("pending draft offers 去签批 when 签批审阅 is on", async () => {
    localStorage.setItem("lawmind.review.requireSignoffReview", "1");
    const onOpenNeedsDecisionDesk = vi.fn();
    const onOpenReview = vi.fn();
    await act(async () => {
      root.render(
        <LawmindChatDraftStatusBar
          apiBase="http://127.0.0.1:1"
          linkedTaskId="t1"
          assistantText="审查意见已拟好。"
          onOpenReview={onOpenReview}
          onOpenNeedsDecisionDesk={onOpenNeedsDecisionDesk}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const btn = host.querySelector('[data-testid="lm-draft-status-signoff"]') as HTMLButtonElement;
    expect(btn?.textContent).toContain("去签批");
    await act(async () => {
      btn.click();
    });
    expect(onOpenNeedsDecisionDesk).toHaveBeenCalledWith({
      taskId: "t1",
      matterId: "m1",
      preferStatus: "awaiting_review",
    });
    expect(onOpenReview).not.toHaveBeenCalled();
  });
});
