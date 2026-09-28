import { describe, expect, it } from "vitest";
import {
  applyChatSessionPointerSelect,
  chatSessionDeleteLabel,
  chatSessionListKeyAction,
  reconcileChatSessionSelection,
  resolveChatSessionContextTarget,
} from "./lawmind-chat-session-selection";

const orderedIds = ["a", "b", "c", "d"];

describe("applyChatSessionPointerSelect", () => {
  it("replaces the selection and opens on a plain click", () => {
    expect(
      applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: ["a", "b"],
        anchorId: "a",
        clickedId: "c",
        shift: false,
        toggle: false,
      }),
    ).toEqual({ selectedIds: ["c"], anchorId: "c", open: true });
  });

  it("toggles one row without opening it", () => {
    expect(
      applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: ["a"],
        anchorId: "a",
        clickedId: "c",
        shift: false,
        toggle: true,
      }),
    ).toEqual({ selectedIds: ["a", "c"], anchorId: "c", open: false });
    expect(
      applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: ["a", "c"],
        anchorId: "c",
        clickedId: "a",
        shift: false,
        toggle: true,
      }).selectedIds,
    ).toEqual(["c"]);
  });

  it("selects the inclusive range from the anchor", () => {
    expect(
      applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: ["b"],
        anchorId: "b",
        clickedId: "d",
        shift: true,
        toggle: false,
      }),
    ).toEqual({ selectedIds: ["b", "c", "d"], anchorId: "b", open: false });
  });

  it("adds the range when shift and toggle are both held", () => {
    expect(
      applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: ["a"],
        anchorId: "c",
        clickedId: "d",
        shift: true,
        toggle: true,
      }).selectedIds,
    ).toEqual(["a", "c", "d"]);
  });
});

describe("resolveChatSessionContextTarget", () => {
  it("keeps the multi-selection when the target is already inside it", () => {
    expect(resolveChatSessionContextTarget(["a", "c"], "c")).toEqual({
      actionIds: ["a", "c"],
      replaceSelection: false,
    });
  });

  it("targets only the row that was not selected", () => {
    expect(resolveChatSessionContextTarget(["a", "c"], "b")).toEqual({
      actionIds: ["b"],
      replaceSelection: true,
    });
  });
});

describe("reconcileChatSessionSelection", () => {
  it("keeps a single non-active selection when only the list refreshes", () => {
    expect(
      reconcileChatSessionSelection({
        selectedIds: ["b"],
        orderedIds,
        activeSessionId: "a",
        activeChanged: false,
      }),
    ).toEqual(["b"]);
  });

  it("falls back to active when the selection is pruned empty", () => {
    expect(
      reconcileChatSessionSelection({
        selectedIds: ["gone"],
        orderedIds,
        activeSessionId: "a",
        activeChanged: false,
      }),
    ).toEqual(["a"]);
  });

  it("follows an external active-session change unless multi-select still includes it", () => {
    expect(
      reconcileChatSessionSelection({
        selectedIds: ["b"],
        orderedIds,
        activeSessionId: "c",
        activeChanged: true,
      }),
    ).toEqual(["c"]);
    expect(
      reconcileChatSessionSelection({
        selectedIds: ["a", "b", "c"],
        orderedIds,
        activeSessionId: "b",
        activeChanged: true,
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("chatSessionListKeyAction", () => {
  it("maps select-all, collapse, and multi-select delete; ignores single-select delete", () => {
    expect(chatSessionDeleteLabel(1)).toBe("删除");
    expect(chatSessionDeleteLabel(3)).toBe("删除 3 条");
    expect(
      chatSessionListKeyAction(
        { key: "a", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: false },
        1,
      ),
    ).toBe("select-all");
    expect(
      chatSessionListKeyAction(
        { key: "Escape", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: false },
        2,
      ),
    ).toBe("collapse");
    expect(
      chatSessionListKeyAction(
        { key: "Backspace", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: false },
        2,
      ),
    ).toBe("delete");
    expect(
      chatSessionListKeyAction(
        { key: "Backspace", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: false },
        1,
      ),
    ).toBe("none");
    expect(
      chatSessionListKeyAction(
        { key: "Delete", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: false },
        1,
      ),
    ).toBe("none");
    expect(
      chatSessionListKeyAction(
        { key: "Backspace", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsField: true },
        2,
      ),
    ).toBe("none");
  });
});
