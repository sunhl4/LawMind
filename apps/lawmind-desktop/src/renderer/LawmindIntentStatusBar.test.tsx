/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindIntentStatusBar } from "./LawmindIntentStatusBar";

describe("LawmindIntentStatusBar", () => {
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

  it("shows inferred contract review when a contract file is attached", async () => {
    await act(async () => {
      root.render(
        <LawmindIntentStatusBar input="帮我看看" fileRelPaths={["买卖合同.docx"]} />,
      );
    });
    expect(host.textContent).toContain("合同审查");
    expect(host.querySelector('[data-testid="lm-intent-status"]')).toBeTruthy();
  });

  it("does not expose override or classify buttons", async () => {
    await act(async () => {
      root.render(
        <LawmindIntentStatusBar input="帮我看看" fileRelPaths={["买卖合同.docx"]} />,
      );
    });
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector('[data-testid="lm-intent-override-litigation.draft"]')).toBeNull();
    expect(host.textContent).not.toContain("改成");
  });

  it("does not guess contract review from keywords when the filename is unnamed", async () => {
    await act(async () => {
      root.render(
        <LawmindIntentStatusBar input="请审查这份采购合同" fileRelPaths={["材料.docx"]} />,
      );
    });
    expect(host.querySelector('[data-testid="lm-intent-status"]')).toBeNull();
  });
});
