import { describe, expect, it } from "vitest";
import { classifySessionInbox, isSessionInboxKind, SESSION_INBOX_KINDS } from "./session-inbox.js";

describe("session-inbox", () => {
  it("names chat as followup and the two mid-turn sidecars", () => {
    expect(classifySessionInbox("chat")).toBe("followup");
    expect(classifySessionInbox("steer")).toBe("steer");
    expect(classifySessionInbox("inject")).toBe("inject");
    expect(SESSION_INBOX_KINDS).toEqual(["followup", "steer", "inject"]);
  });

  it("guards unknown strings", () => {
    expect(isSessionInboxKind("followup")).toBe(true);
    expect(isSessionInboxKind("wake")).toBe(false);
  });
});
