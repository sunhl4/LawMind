import { describe, expect, it } from "vitest";
import { ADHOC_MEETING_MATTER_ID, isAdhocMeetingMatterId } from "./lawmind-meeting-scope";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { lawmindMainViewLabel } from "./lawmind-main-view";

describe("meeting scope", () => {
  it("adhoc matter id is a valid matter id", () => {
    expect(isValidMatterId(ADHOC_MEETING_MATTER_ID)).toBe(true);
    expect(isAdhocMeetingMatterId(ADHOC_MEETING_MATTER_ID)).toBe(true);
    expect(isAdhocMeetingMatterId("other")).toBe(false);
  });

  it("labels meeting main view", () => {
    expect(lawmindMainViewLabel("meeting")).toBe("会议室");
  });
});
