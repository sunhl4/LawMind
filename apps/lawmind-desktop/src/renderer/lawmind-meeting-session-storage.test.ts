/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  meetingAuthorLabel,
  readMeetingParticipants,
  readMeetingSessionMap,
  writeMeetingParticipants,
  writeMeetingSessionMap,
} from "./lawmind-meeting-session-storage";

describe("lawmind-meeting-session-storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips session map and skips blank values", () => {
    writeMeetingSessionMap("m1", { a: "sess-1", b: "  ", c: undefined });
    expect(readMeetingSessionMap("m1")).toEqual({ a: "sess-1" });
  });

  it("round-trips participants", () => {
    writeMeetingParticipants("m1", ["asst-1", "asst-2"]);
    expect(readMeetingParticipants("m1")).toEqual(["asst-1", "asst-2"]);
  });

  it("labels timeline authors for lawyer UI", () => {
    expect(meetingAuthorLabel({ kind: "user" } as never)).toBe("您");
    expect(meetingAuthorLabel({ kind: "system" } as never)).toBe("主持人");
    expect(
      meetingAuthorLabel({ kind: "assistant", displayName: "研究员", assistantId: "r1" } as never),
    ).toBe("研究员");
  });
});
