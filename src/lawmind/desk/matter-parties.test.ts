import { describe, expect, it } from "vitest";
import {
  carryPartyContacts,
  contactConsentState,
  contactIdentityKey,
  duplicateContactIdentities,
  MATTER_PARTIES_CAP,
  MATTER_PARTY_CONTACTS_CAP,
  normalizeContactAccount,
  normalizeContactValue,
  normalizeMatterParties,
  normalizeMatterPartyContacts,
  removePartyContact,
  samePartyName,
  upsertPartyContact,
  type MatterParty,
} from "./matter-parties.js";

describe("matter parties cap", () => {
  it("keeps a 共同诉讼 defendant list (12 parties) instead of silently dropping the 9th", () => {
    const parties: MatterParty[] = [
      { partyId: "p-client", name: "原告公司", role: "client" },
      ...Array.from({ length: 11 }, (_, i) => ({
        partyId: `p-counterparty-${i + 1}`,
        name: `被告${i + 1}`,
        role: "counterparty" as const,
      })),
    ];
    const normalized = normalizeMatterParties(parties);
    expect(normalized).toHaveLength(12);
    expect(normalized.at(-1)?.name).toBe("被告11");
  });

  it("still bounds pathological input at the cap", () => {
    const many: MatterParty[] = Array.from({ length: MATTER_PARTIES_CAP + 20 }, (_, i) => ({
      partyId: `p-${i}`,
      name: `当事人${i}`,
      role: "other" as const,
    }));
    expect(normalizeMatterParties(many)).toHaveLength(MATTER_PARTIES_CAP);
  });
});

describe("samePartyName", () => {
  it("treats a company and its 有限公司 form as the same party", () => {
    expect(samePartyName("北京甲公司", "北京甲有限公司")).toBe(true);
    expect(samePartyName(" 北京甲 公司 ", "北京甲股份有限公司")).toBe(true);
  });

  it("does not treat different short names as the same party", () => {
    expect(samePartyName("甲公司", "乙公司")).toBe(false);
    expect(samePartyName("北京甲", "北京甲乙")).toBe(false);
  });
});

describe("party contacts", () => {
  it("normalizes email / mainland mobile / wecom ids and rejects junk", () => {
    expect(normalizeContactValue("email", " Zhang.San@Firm.CN ")).toBe("zhang.san@firm.cn");
    expect(normalizeContactValue("email", "张三 <a@b.cn>")).toBeUndefined();
    expect(normalizeContactValue("phone", "+86 138-0013-8000")).toBe("13800138000");
    expect(normalizeContactValue("phone", "0086 13800138000")).toBe("13800138000");
    expect(normalizeContactValue("phone", "021-6888 8888")).toBe("02168888888");
    expect(normalizeContactValue("phone", "abc")).toBeUndefined();
    expect(normalizeContactValue("wecom", "wmABC_123-x")).toBe("wmABC_123-x");
    expect(normalizeContactValue("wecom", "有空格 的")).toBeUndefined();
  });

  it("dedupes by kind+value, keeps verified, and caps the list", () => {
    const contacts = normalizeMatterPartyContacts([
      { kind: "email", value: "A@b.cn" },
      { kind: "email", value: "a@b.cn", verified: true },
      ...Array.from({ length: MATTER_PARTY_CONTACTS_CAP + 3 }, (_, i) => ({
        kind: "phone" as const,
        value: `1380000${String(i).padStart(4, "0")}`,
      })),
    ]);
    expect(contacts[0]).toEqual({ kind: "email", value: "a@b.cn", verified: true });
    expect(contacts).toHaveLength(MATTER_PARTY_CONTACTS_CAP);
  });

  it("normalizeMatterParties carries contacts through", () => {
    const [party] = normalizeMatterParties([
      {
        partyId: "p-client",
        name: "甲公司",
        role: "client",
        contacts: [{ kind: "email", value: "LEGAL@jia.cn", verified: true, source: "lawyer" }],
      },
    ]);
    expect(party?.contacts).toEqual([
      { kind: "email", value: "legal@jia.cn", verified: true, source: "lawyer" },
    ]);
  });

  it("carryPartyContacts keeps contacts only when the editor omitted them", () => {
    const existing: MatterParty[] = [
      {
        partyId: "p-client",
        name: "甲公司",
        role: "client",
        contacts: [{ kind: "email", value: "a@jia.cn", verified: true }],
      },
    ];
    const carried = carryPartyContacts(
      [
        { partyId: "p-client", name: "甲有限公司", role: "client" },
        { partyId: "p-counterparty", name: "乙公司", role: "counterparty" },
      ],
      existing,
    );
    expect(carried[0]?.contacts?.[0]?.value).toBe("a@jia.cn");
    expect(carried[1]?.contacts).toBeUndefined();
    const cleared = carryPartyContacts(
      [{ partyId: "p-client", name: "甲公司", role: "client", contacts: [] }],
      existing,
    );
    expect(cleared[0]?.contacts).toEqual([]);
  });

  it("upsertPartyContact upgrades an existing unverified contact", () => {
    const next = upsertPartyContact(
      [
        {
          partyId: "p-client",
          name: "甲公司",
          role: "client",
          contacts: [{ kind: "email", value: "a@jia.cn", source: "document" }],
        },
      ],
      "p-client",
      { kind: "email", value: "A@jia.cn", verified: true, source: "intake_confirmed" },
    );
    expect(next?.[0]?.contacts).toEqual([
      { kind: "email", value: "a@jia.cn", verified: true, source: "document" },
    ]);
    expect(upsertPartyContact([], "p-x", { kind: "email", value: "a@b.cn" })).toBeUndefined();
  });

  it("removePartyContact drops the field when the last contact goes", () => {
    const next = removePartyContact(
      [
        {
          partyId: "p-client",
          name: "甲公司",
          role: "client",
          contacts: [{ kind: "email", value: "a@jia.cn", verified: true }],
        },
      ],
      "email",
      "A@JIA.cn",
    );
    expect(next[0]).toEqual({ partyId: "p-client", name: "甲公司", role: "client" });
  });
});

describe("contact identity and consent", () => {
  it("normalizes the channel account and keeps email case-insensitive", () => {
    expect(normalizeContactAccount("  Mailbox-A@Firm.CN ")).toBe("mailbox-a@firm.cn");
    expect(normalizeContactAccount(undefined)).toBeUndefined();
    expect(normalizeContactAccount("x".repeat(81))).toBeUndefined();
  });

  it("uses externalId over the display value, and the account separates identities", () => {
    expect(contactIdentityKey({ kind: "email", value: "A@B.cn", account: "M@X.cn" })).toBe(
      "email|m@x.cn|a@b.cn",
    );
    expect(
      contactIdentityKey({ kind: "wecom", value: "张三", account: "corp-1", externalId: "zs" }),
    ).toBe("wecom|corp-1|id:zs");
    expect(contactIdentityKey({ kind: "wecom", value: "张三", externalId: "zs" })).not.toBe(
      contactIdentityKey({ kind: "wecom", value: "张三", account: "corp-1", externalId: "zs" }),
    );
  });

  it("keeps the same email under two accounts as two identities", () => {
    const contacts = normalizeMatterPartyContacts([
      { kind: "email", value: "client@example.com", account: "mailbox-a@firm.cn" },
      { kind: "email", value: "client@example.com", account: "mailbox-b@firm.cn" },
    ]);
    expect(contacts).toHaveLength(2);
    expect(new Set(contacts.map((contact) => contactIdentityKey(contact))).size).toBe(2);
  });

  it("dedupes one external id inside an account instead of the display value", () => {
    const contacts = normalizeMatterPartyContacts([
      { kind: "wecom", value: "wmABC", account: "corp-1", externalId: "zhangsan" },
      {
        kind: "wecom",
        value: "wmXYZ",
        account: "Corp-1",
        externalId: "zhangsan",
        verified: true,
        source: "lawyer",
      },
      { kind: "wecom", value: "wmABC", account: "corp-2", externalId: "zhangsan" },
    ]);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      kind: "wecom",
      value: "wmABC",
      account: "corp-1",
      externalId: "zhangsan",
      verified: true,
      source: "lawyer",
    });
    expect(contacts[1]?.account).toBe("corp-2");
  });

  it("keeps the more conservative consent when the same identity is registered twice", () => {
    const contacts = normalizeMatterPartyContacts([
      {
        kind: "phone",
        value: "13800138000",
        recordingConsent: { state: "granted", at: "2026-10-01", source: "intake_confirmed" },
      },
      {
        kind: "phone",
        value: "138-0013-8000",
        recordingConsent: { state: "denied", at: "2026-10-02", source: "lawyer" },
      },
    ]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.recordingConsent).toEqual({
      state: "denied",
      at: "2026-10-02",
      source: "lawyer",
    });
    expect(contactConsentState(contacts[0], "archive")).toBe("unknown");
  });

  it("reports one identity registered under two parties without merging them", () => {
    const parties = normalizeMatterParties([
      {
        partyId: "p-client",
        name: "甲公司",
        role: "client",
        contacts: [{ kind: "wecom", value: "wmABC", account: "corp-1", externalId: "zhangsan" }],
      },
      {
        partyId: "p-counterparty",
        name: "乙公司",
        role: "counterparty",
        contacts: [{ kind: "wecom", value: "wmXYZ", account: "corp-1", externalId: "zhangsan" }],
      },
    ]);
    expect(duplicateContactIdentities(parties)).toEqual([
      { key: "wecom|corp-1|id:zhangsan", partyIds: ["p-client", "p-counterparty"] },
    ]);
  });

  it("removes only the matching account when the same value is registered twice", () => {
    const parties: MatterParty[] = [
      {
        partyId: "p-client",
        name: "甲公司",
        role: "client",
        contacts: [
          { kind: "email", value: "a@jia.cn", account: "mailbox-a@firm.cn" },
          { kind: "email", value: "a@jia.cn", account: "mailbox-b@firm.cn" },
        ],
      },
    ];
    const scoped = removePartyContact(parties, "email", "A@JIA.cn", undefined, "mailbox-a@firm.cn");
    expect(scoped[0]?.contacts).toEqual([
      { kind: "email", value: "a@jia.cn", account: "mailbox-b@firm.cn" },
    ]);
    const all = removePartyContact(parties, "email", "a@jia.cn");
    expect(all[0]).toEqual({ partyId: "p-client", name: "甲公司", role: "client" });
  });
});
