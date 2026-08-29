import { describe, expect, it } from "vitest";
import { buildJudgmentHardControlsReport } from "./lawmind-health-payload.js";

describe("buildJudgmentHardControlsReport", () => {
  it("defaults intake/amplitude soft and empty redline/send hard", () => {
    const r = buildJudgmentHardControlsReport({});
    expect(r.intakeSoftAsk).toBe(true);
    expect(r.updateDraftAmplitudeSoft).toBe(true);
    expect(r.emptyRedlineHard).toBe(true);
    expect(r.sendEmailApprovalHard).toBe(true);
  });

  it("marks amplitude hard when LAWMIND_SURGICAL_ENFORCE=1", () => {
    const r = buildJudgmentHardControlsReport({ LAWMIND_SURGICAL_ENFORCE: "1" });
    expect(r.updateDraftAmplitudeSoft).toBe(false);
  });
});
