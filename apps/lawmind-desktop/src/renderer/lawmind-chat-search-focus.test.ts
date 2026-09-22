import { describe, expect, it } from "vitest";
import { isChatSearchFocusHotkey } from "./lawmind-chat-search-focus";

describe("isChatSearchFocusHotkey", () => {
  it("matches Cmd/Ctrl+Shift+O and ignores other chords", () => {
    expect(
      isChatSearchFocusHotkey({
        key: "o",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(
      isChatSearchFocusHotkey({
        key: "O",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(
      isChatSearchFocusHotkey({
        key: "o",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
    expect(
      isChatSearchFocusHotkey({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
  });
});
