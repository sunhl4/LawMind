import { describe, expect, it } from "vitest";
import { notePresence, presenceFromWork, strongerPresence } from "./presence.js";

describe("assistant presence", () => {
  const now = Date.parse("2026-09-26T00:00:00.000Z");

  it("maps work status onto the six states a lawyer can see", () => {
    expect(presenceFromWork("running", "2026-09-26T00:00:00.000Z", now)).toBe("working");
    expect(presenceFromWork("needs_signoff", "2026-09-26T00:00:00.000Z", now)).toBe("waiting");
    expect(presenceFromWork("needs_lawyer", "2026-09-26T00:00:00.000Z", now)).toBe("blocked");
    expect(presenceFromWork("open", "2026-09-26T00:00:00.000Z", now)).toBe("thinking");
    expect(presenceFromWork("done", "2026-09-25T12:00:00.000Z", now)).toBe("done");
    expect(presenceFromWork("done", "2026-09-20T00:00:00.000Z", now)).toBe("idle");
  });

  it("keeps the state that needs the lawyer more", () => {
    expect(strongerPresence("working", "blocked")).toBe("blocked");
    expect(strongerPresence("blocked", "done")).toBe("blocked");
    const noted = notePresence(
      notePresence(undefined, "working", "在改合同"),
      "blocked",
      "等你拍板",
    );
    expect(noted).toEqual({ presence: "blocked", detail: "等你拍板" });
  });
});
