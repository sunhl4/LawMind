import { describe, expect, it } from "vitest";
import {
  deriveMatterIdentity,
  formatPartyServiceLine,
  hydrateMatterParties,
  matterPartyEditorDrafts,
  matterPartyIdentityNames,
  normalizeMatterParties,
  syncLegacyIdentityIntoParties,
} from "./matter-parties.js";

describe("matter parties", () => {
  it("hydrates legacy clientId / counterparty into cards", () => {
    const rows = hydrateMatterParties({
      clientId: "甲公司",
      counterparty: "乙公司",
    });
    expect(rows.map((row) => `${row.role}:${row.name}`)).toEqual([
      "client:甲公司",
      "counterparty:乙公司",
    ]);
    expect(deriveMatterIdentity(rows)).toEqual({
      clientId: "甲公司",
      counterparty: "乙公司",
    });
  });

  it("prefers the parties array over legacy strings", () => {
    const rows = hydrateMatterParties({
      clientId: "旧客户",
      counterparty: "旧对方",
      parties: [
        {
          partyId: "p-client",
          name: "星辉精密",
          role: "client",
          standing: "原告",
          serviceAddress: "上海浦东",
          serviceMethod: "mail",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("星辉精密");
    expect(formatPartyServiceLine(rows[0])).toBe("邮寄 · 上海浦东");
  });

  it("drops empty names, caps at 8, and keeps extra roles when identity strings change", () => {
    const normalized = normalizeMatterParties([
      { partyId: "p-client", name: "  ", role: "client" },
      { partyId: "p-client", name: "甲", role: "client" },
      { partyId: "dup", name: "乙", role: "counterparty" },
      { partyId: "dup", name: "丙代理", role: "counsel" },
    ]);
    expect(normalized.map((row) => row.partyId)).toEqual(["p-client", "dup", "p-counsel"]);
    const synced = syncLegacyIdentityIntoParties(normalized, "甲新", undefined);
    expect(synced?.some((row) => row.role === "counsel" && row.name === "丙代理")).toBe(true);
    expect(synced?.some((row) => row.role === "counterparty")).toBe(false);
    expect(deriveMatterIdentity(synced ?? [])).toEqual({ clientId: "甲新" });
  });

  it("editor drafts always expose 委托人 / 对方 slots", () => {
    const drafts = matterPartyEditorDrafts([]);
    expect(drafts.map((row) => row.role)).toEqual(["client", "counterparty"]);
    expect(matterPartyIdentityNames({ parties: drafts })).toEqual([]);
  });
});
