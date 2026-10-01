import { describe, expect, it, vi } from "vitest";
import { buildChatDeepLinkHandlers } from "./main-body-deep-links";

describe("buildChatDeepLinkHandlers", () => {
  it("keeps the dossier open and shows chat when continuing a matter", () => {
    const setMatterCockpitOpen = vi.fn();
    const setMainView = vi.fn();
    const setContextMatterId = vi.fn();
    const setInput = vi.fn();
    const focusComposer = vi.fn();
    const showChatPane = vi.fn();
    const handlers = buildChatDeepLinkHandlers({
      setContextMatterId,
      setMatterCockpitOpen,
      setMainView,
      setContextTaskId: vi.fn(),
      selectChatSession: vi.fn(),
      scheduleScrollChatMessagesToLatest: vi.fn(),
      setInput,
      focusComposer,
      showChatPane,
    });

    handlers.onGoToChat({ matterId: "m1", prompt: "接着写起诉状" });

    expect(setMatterCockpitOpen).not.toHaveBeenCalled();
    expect(showChatPane).toHaveBeenCalledTimes(1);
    expect(setMainView).toHaveBeenCalledWith("workspace");
    expect(setContextMatterId).toHaveBeenCalledWith("m1");
    expect(setInput).toHaveBeenCalledWith("接着写起诉状");
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });
});
