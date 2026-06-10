/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindRequiresActionStrip } from "./LawmindRequiresActionStrip";

describe("LawmindRequiresActionStrip", () => {
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

  it("renders nothing when no pending items", async () => {
    await act(async () => {
      root.render(
        <LawmindRequiresActionStrip
          pendingApprovalCount={0}
          clarificationPending={false}
          clarificationCount={0}
        />,
      );
    });
    expect(host.querySelector(".lm-requires-action-strip")).toBeNull();
  });

  it("shows badge text when approvals and clarifications pending", async () => {
    await act(async () => {
      root.render(
        <LawmindRequiresActionStrip
          pendingApprovalCount={2}
          clarificationPending={true}
          clarificationCount={1}
        />,
      );
    });
    const strip = host.querySelector(".lm-requires-action-strip");
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain("2 项待批准");
    expect(strip?.textContent).toContain("1 项待澄清");
  });
});
