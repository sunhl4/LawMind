import { describe, expect, it } from "vitest";
import {
  findLawyerPause,
  LAWYER_PAUSE_REGISTRY,
  lawyerPauseKinds,
} from "./lawyer-pause-registry.js";

describe("lawyer-pause-registry", () => {
  it("keeps the post-交办即终稿 pause set small and documented", () => {
    expect(LAWYER_PAUSE_REGISTRY.length).toBeLessThanOrEqual(8);
    expect(lawyerPauseKinds()).toEqual([
      "user_abort",
      "icloud_download",
      "ethics_wall_outbound",
      "judgment_escalation",
      "workflow_blocked_gate",
      "legacy_continue_tools",
    ]);
    for (const entry of LAWYER_PAUSE_REGISTRY) {
      expect(entry.assumption.trim().length).toBeGreaterThan(8);
      expect(entry.ablateWhen.trim().length).toBeGreaterThan(4);
    }
  });

  it("does not register retired mid-delivery pauses", () => {
    const kinds = new Set(lawyerPauseKinds());
    expect(kinds.has("user_abort")).toBe(true);
    // These must NOT reappear as registry kinds (they complete with gaps / 待发).
    expect(
      LAWYER_PAUSE_REGISTRY.some((e) => /clarification|verify|send_email|intake/i.test(e.kind)),
    ).toBe(false);
    expect(findLawyerPause("ethics_wall_outbound")?.surface).toContain("ethics");
  });
});
