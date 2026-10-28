import { describe, expect, it } from "vitest";
import { resolveIntakeItem, type IntakeMatterIndex } from "./resolve.js";
import { IntakeItemSchema, type IntakeItem } from "./types.js";

function emailItem(overrides: Partial<IntakeItem> = {}): IntakeItem {
  return IntakeItemSchema.parse({
    schemaVersion: 1,
    id: "it-abcdefgh",
    channel: "email",
    externalKey: "email:1",
    trust: "untrusted",
    receivedAt: "2026-10-27T00:00:00.000Z",
    recordedAt: "2026-10-27T00:00:00.000Z",
    text: "附件是补充材料",
    attachments: [],
    status: "pending",
    ...overrides,
  });
}

function indexWithContact(contact: { account?: string; verified?: boolean }): IntakeMatterIndex {
  return {
    matters: [
      {
        matterId: "m1",
        title: "甲案",
        caseNos: [],
        parties: [],
        contacts: [
          {
            partyId: "p-client",
            kind: "email",
            value: "client@example.com",
            verified: contact.verified !== false,
            ...(contact.account ? { account: contact.account } : {}),
          },
        ],
      },
    ],
    threadRefs: {},
  };
}

describe("intake contact matching across channel accounts", () => {
  it("auto-attaches a verified sender when the mailbox account matches", () => {
    const item = emailItem({
      from: { display: "Client", address: "client@example.com" },
      source: { accountId: "Mailbox-A@Firm.CN" },
    });
    const resolution = resolveIntakeItem(item, indexWithContact({ account: "mailbox-a@firm.cn" }));
    expect(resolution.decision).toBe("auto_attach");
    expect(resolution.candidates[0]?.keys.map((key) => key.kind)).toContain("verified_contact");
  });

  it("does not merge the same address seen through a different mailbox", () => {
    const item = emailItem({
      from: { display: "Client", address: "client@example.com" },
      source: { accountId: "mailbox-b@firm.cn" },
    });
    const resolution = resolveIntakeItem(item, indexWithContact({ account: "mailbox-a@firm.cn" }));
    expect(resolution.decision).toBe("unmatched");
    expect(resolution.candidates).toHaveLength(0);
  });

  it("keeps legacy contacts without an account usable", () => {
    const item = emailItem({
      from: { display: "Client", address: "client@example.com" },
      source: { accountId: "mailbox-b@firm.cn" },
    });
    expect(resolveIntakeItem(item, indexWithContact({})).decision).toBe("auto_attach");
  });

  it("keeps matching when the item has no mailbox account (dropped .eml)", () => {
    const item = emailItem({ from: { display: "Client", address: "client@example.com" } });
    expect(
      resolveIntakeItem(item, indexWithContact({ account: "mailbox-a@firm.cn" })).decision,
    ).toBe("auto_attach");
  });

  it("does not auto-attach an unverified contact", () => {
    const item = emailItem({
      from: { display: "Client", address: "client@example.com" },
      source: { accountId: "mailbox-a@firm.cn" },
    });
    const resolution = resolveIntakeItem(
      item,
      indexWithContact({ account: "mailbox-a@firm.cn", verified: false }),
    );
    expect(resolution.decision).toBe("propose");
    expect(resolution.candidates[0]?.keys.map((key) => key.kind)).not.toContain("verified_contact");
  });
});
