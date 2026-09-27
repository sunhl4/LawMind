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

function installLocalStorage(): Storage {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

describe("lawmind-meeting-session-storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    installLocalStorage();
  });

  it("round-trips session map and skips blank values", () => {
    writeMeetingSessionMap("m1", { a: "sess-1", b: "  ", c: undefined });
    expect(readMeetingSessionMap("m1")).toEqual({ a: "sess-1" });
  });

  it("round-trips participants", () => {
    writeMeetingParticipants("m1", ["asst-1", "asst-2"]);
    expect(readMeetingParticipants("m1")).toEqual(["asst-1", "asst-2"]);
    expect(window.localStorage.getItem("lawmind.teamMeeting.participants.m1")).toContain("asst-1");
  });

  it("migrates a roster left in the old session store", () => {
    window.sessionStorage.setItem(
      "lawmind.teamMeeting.participants.m1",
      JSON.stringify(["asst-legacy"]),
    );
    expect(readMeetingParticipants("m1")).toEqual(["asst-legacy"]);
    expect(window.localStorage.getItem("lawmind.teamMeeting.participants.m1")).toContain(
      "asst-legacy",
    );
  });

  it("labels timeline authors for lawyer UI", () => {
    expect(meetingAuthorLabel({ kind: "user" } as never)).toBe("您");
    expect(meetingAuthorLabel({ kind: "system" } as never)).toBe("主持人");
    expect(
      meetingAuthorLabel({ kind: "assistant", displayName: "研究员", assistantId: "r1" } as never),
    ).toBe("研究员");
  });
});
