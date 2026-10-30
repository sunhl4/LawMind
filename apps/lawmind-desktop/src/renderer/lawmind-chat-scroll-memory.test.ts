/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
  clearChatScrollPositions,
  isChatScrolledToBottom,
  measureChatScrollFromBottom,
  readChatScrollPosition,
  rememberChatScrollPosition,
} from "./lawmind-chat-scroll-memory";

function makePanel(scrollHeight: number, clientHeight: number) {
  const panel = document.createElement("div");
  panel.id = "lawmind-chat-messages-panel";
  Object.defineProperty(panel, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(panel, "clientHeight", { value: clientHeight, configurable: true });
  panel.scrollTop = 0;
  document.body.appendChild(panel);
  return panel;
}

describe("chat scroll memory", () => {
  beforeEach(() => {
    clearChatScrollPositions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    clearChatScrollPositions();
  });

  it("remembers a position per session and isolates sessions", () => {
    rememberChatScrollPosition("s-1", 320);
    rememberChatScrollPosition("s-2", 0);
    expect(readChatScrollPosition("s-1")).toEqual({ fromBottom: 320 });
    expect(readChatScrollPosition("s-2")).toEqual({ fromBottom: 0 });
    expect(readChatScrollPosition("s-3")).toBeNull();
  });

  it("trims ids, clamps negatives and ignores unusable values", () => {
    rememberChatScrollPosition("  s-1  ", -10);
    rememberChatScrollPosition("s-2", Number.NaN);
    rememberChatScrollPosition("", 100);
    expect(readChatScrollPosition("s-1")).toEqual({ fromBottom: 0 });
    expect(readChatScrollPosition("s-2")).toBeNull();
  });

  it("measures the from-bottom distance of the real scroller", () => {
    const panel = makePanel(100, 100);
    const nested = document.createElement("div");
    nested.className = "lm-messages-virtual-scroll";
    Object.defineProperty(nested, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(nested, "clientHeight", { value: 400, configurable: true });
    nested.scrollTop = 700;
    panel.appendChild(nested);

    expect(measureChatScrollFromBottom()).toBe(900);
  });

  it("treats the small bottom tolerance as pinned", () => {
    expect(isChatScrolledToBottom(0)).toBe(true);
    expect(isChatScrolledToBottom(CHAT_SCROLL_BOTTOM_THRESHOLD_PX)).toBe(true);
    expect(isChatScrolledToBottom(CHAT_SCROLL_BOTTOM_THRESHOLD_PX + 1)).toBe(false);
  });
});
