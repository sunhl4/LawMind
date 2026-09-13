/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindDesktopRequiredPage } from "./LawmindDesktopRequiredPage";

describe("LawmindDesktopRequiredPage", () => {
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

  it("does not render 工作台 chrome, only the desktop-window instruction", async () => {
    await act(async () => {
      root.render(<LawmindDesktopRequiredPage />);
    });
    expect(host.querySelector('[data-testid="lm-desktop-required"]')).toBeTruthy();
    expect(host.textContent).toContain("这不是 LawMind 工作台");
    expect(host.textContent).toContain("不要用浏览器打开本地址");
    expect(host.querySelector('[data-testid="lm-tab-desk"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-lawyer-workbench"]')).toBeNull();
  });
});
