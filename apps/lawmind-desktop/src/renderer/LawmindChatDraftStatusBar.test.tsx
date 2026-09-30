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

  it("does not offer a signoff desk", async () => {
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
    expect(host.querySelector('[data-testid="lm-draft-status-signoff"]')).toBeNull();
    expect(host.textContent ?? "").not.toContain("去签批");
    expect(host.textContent ?? "").not.toContain("看修订");
  });
});
