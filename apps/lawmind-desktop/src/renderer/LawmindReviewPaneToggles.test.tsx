/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindReviewPaneToggles } from "./LawmindReviewPaneToggles";

describe("LawmindReviewPaneToggles", () => {
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

  it("invokes onToggle when a pane button is clicked", async () => {
    const onToggle = vi.fn();
    await act(async () => {
      root.render(
        <LawmindReviewPaneToggles
          visibility={{ meta: true, editor: true, preview: false }}
          onToggle={onToggle}
        />,
      );
    });
    const buttons = host.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
