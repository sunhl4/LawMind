import { describe, expect, it } from "vitest";
import { shouldShowDraftStatusHint } from "./lawmind-draft-status-hint";

describe("shouldShowDraftStatusHint", () => {
  it("hides when no linked task", () => {
    expect(shouldShowDraftStatusHint({ role: "assistant", linkedTaskId: null }).show).toBe(false);
  });

  it("shows short pending hint", () => {
    const h = shouldShowDraftStatusHint({
      role: "assistant",
      linkedTaskId: "t1",
      reviewStatus: "pending",
    });
    expect(h.show).toBe(true);
    expect(h.message).toBe("已出结果，可改稿");
  });

  it("does not lecture on overconfident phrasing", () => {
    const h = shouldShowDraftStatusHint({
      role: "assistant",
      linkedTaskId: "t1",
      reviewStatus: "pending",
      assistantText: "EMS 已全部就绪，可直接对外发送。",
    });
    expect(h.heuristic).toBeFalsy();
    expect(h.message).toBe("已出结果，可改稿");
  });
});
