/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatReviewSticky } from "./LawmindChatReviewSticky";

describe("LawmindChatReviewSticky", () => {
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
  });

  it("deep-links the primary pending draft into 文书台", async () => {
    const onOpenReview = vi.fn();
    await act(async () => {
      root.render(
        <LawmindChatReviewSticky
          actionSummary={{
            pendingReviewCount: 2,
            pendingReviewDrafts: [
              {
                taskId: "t1",
                matterId: "m1",
                title: "律师函草稿",
                reviewStatus: "pending",
                createdAt: "2026-07-19T00:00:00.000Z",
              },
              {
                taskId: "t2",
                title: "补充意见",
                reviewStatus: "modified",
                createdAt: "2026-07-19T01:00:00.000Z",
              },
            ],
          }}
          onOpenReview={onOpenReview}
        />,
      );
    });
    expect(host.textContent).toContain("律师函草稿");
    expect(host.textContent).toContain("另有 1 份");
    const open = host.querySelector('[data-testid="lm-chat-review-sticky-open"]') as HTMLButtonElement;
    open.click();
    expect(onOpenReview).toHaveBeenCalledWith({ taskId: "t1", matterId: "m1" });
    const second = host.querySelector('[data-testid="lm-chat-review-draft-t2"]') as HTMLButtonElement;
    second.click();
    expect(onOpenReview).toHaveBeenCalledWith({ taskId: "t2", matterId: undefined });
  });

  it("hides when there are no pending reviews", async () => {
    await act(async () => {
      root.render(
        <LawmindChatReviewSticky
          actionSummary={{ pendingReviewCount: 0, pendingReviewDrafts: [] }}
          onOpenReview={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-chat-review-sticky"]')).toBeNull();
  });
});
