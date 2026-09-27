import { describe, expect, it } from "vitest";
import {
  MATTER_PARTIES_CAP,
  normalizeMatterParties,
  samePartyName,
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
