/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollChatMessagesToLatest } from "./lawmind-chat-scroll";

describe("scrollChatMessagesToLatest", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets scrollTop to scrollHeight on the messages panel", () => {
    const panel = document.createElement("div");
    panel.id = "lawmind-chat-messages-panel";
    Object.defineProperty(panel, "scrollHeight", { value: 2400, configurable: true });
    panel.scrollTop = 0;
    panel.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      panel.scrollTop = Number(top ?? 0);
    }) as unknown as typeof panel.scrollTo;
    document.body.appendChild(panel);

    scrollChatMessagesToLatest({ behavior: "auto" });
    expect(panel.scrollTop).toBe(2400);
  });

  it("also scrolls a nested virtual list container", () => {
    const panel = document.createElement("div");
    panel.id = "lawmind-chat-messages-panel";
    Object.defineProperty(panel, "scrollHeight", { value: 100, configurable: true });
    panel.scrollTop = 0;
    panel.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      panel.scrollTop = Number(top ?? 0);
    }) as unknown as typeof panel.scrollTo;

    const nested = document.createElement("div");
    nested.className = "lm-messages-virtual-scroll";
    Object.defineProperty(nested, "scrollHeight", { value: 3000, configurable: true });
    nested.scrollTop = 12;
    nested.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      nested.scrollTop = Number(top ?? 0);
    }) as unknown as typeof nested.scrollTo;
    panel.appendChild(nested);
    document.body.appendChild(panel);

    scrollChatMessagesToLatest({ behavior: "auto" });
    expect(nested.scrollTop).toBe(3000);
    expect(panel.scrollTop).toBe(100);
  });
});
