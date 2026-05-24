import { describe, expect, it } from "vitest";
import { shouldShowDraftStatusHint } from "./lawmind-draft-status-hint";

describe("shouldShowDraftStatusHint", () => {
  it("hides when no linked task", () => {
    expect(shouldShowDraftStatusHint({ role: "assistant", linkedTaskId: null }).show).toBe(false);
  });

  it("shows pending hint", () => {
    const h = shouldShowDraftStatusHint({
      role: "assistant",
      linkedTaskId: "t1",
      reviewStatus: "pending",
    });
    expect(h.show).toBe(true);
    expect(h.message).toContain("审核");
  });

  it("flags overconfident EMS phrasing when still pending", () => {
    const h = shouldShowDraftStatusHint({
      role: "assistant",
      linkedTaskId: "t1",
      reviewStatus: "pending",
      assistantText: "EMS 已全部就绪，可直接对外发送。",
    });
    expect(h.heuristic).toBe(true);
    expect(h.show).toBe(true);
  });
});
