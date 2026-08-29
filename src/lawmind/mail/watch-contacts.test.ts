import { describe, expect, it } from "vitest";
import {
  describeWatchContacts,
  messageMatchesWatchContacts,
  normalizeEmailAddress,
  sanitizeWatchContacts,
} from "./watch-contacts.js";

describe("watch-contacts", () => {
  it("empty list matches all messages", () => {
    expect(messageMatchesWatchContacts({ from: "a@x.com", to: "me@y.com" }, [])).toBe(true);
  });

  it("filters by counterpart in from or to", () => {
    const contacts = sanitizeWatchContacts([
      { email: "Law@Corp.com", label: "对方法务", note: "合同谈判" },
    ]);
    expect(contacts[0]?.email).toBe("law@corp.com");
    expect(
      messageMatchesWatchContacts({ from: "对方法务 <law@corp.com>", to: "me@firm.com" }, contacts),
    ).toBe(true);
    expect(messageMatchesWatchContacts({ from: "other@x.com", to: "me@firm.com" }, contacts)).toBe(
      false,
    );
    expect(messageMatchesWatchContacts({ from: "me@firm.com", to: "law@corp.com" }, contacts)).toBe(
      true,
    );
  });

  it("normalizes angle-bracket addresses", () => {
    expect(normalizeEmailAddress("张三 <A@B.Com>")).toBe("a@b.com");
  });

  it("describeWatchContacts explains modes", () => {
    expect(describeWatchContacts([])).toContain("全部往来");
    expect(
      describeWatchContacts([{ email: "a@b.com", label: "客户", note: "主联系人" }]),
    ).toContain("客户");
  });
});
