import { afterEach, describe, expect, it } from "vitest";
import {
  isAuthorityLive,
  isAuthorityOfficialPublic,
  resolveAuthoritySourceTier,
  WORKSPACE_HEURISTIC_SOURCE_TIER,
} from "./authority-source-tier.js";

describe("authority-source-tier", () => {
  const prev = {
    provider: process.env.LAWMIND_AUTHORITY_PROVIDER,
    endpoint: process.env.LAWMIND_AUTHORITY_ENDPOINT,
    key: process.env.LAWMIND_AUTHORITY_API_KEY,
    npc: process.env.LAWMIND_OPEN_LAW_NPC,
  };

  afterEach(() => {
    if (prev.provider === undefined) {
      delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    } else {
      process.env.LAWMIND_AUTHORITY_PROVIDER = prev.provider;
    }
    if (prev.endpoint === undefined) {
      delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    } else {
      process.env.LAWMIND_AUTHORITY_ENDPOINT = prev.endpoint;
    }
    if (prev.key === undefined) {
      delete process.env.LAWMIND_AUTHORITY_API_KEY;
    } else {
      process.env.LAWMIND_AUTHORITY_API_KEY = prev.key;
    }
    if (prev.npc === undefined) {
      delete process.env.LAWMIND_OPEN_LAW_NPC;
    } else {
      process.env.LAWMIND_OPEN_LAW_NPC = prev.npc;
    }
  });

  it("defaults to sample and never treats workspace heuristic as live", () => {
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_API_KEY;
    expect(WORKSPACE_HEURISTIC_SOURCE_TIER).toBe("sample");
    expect(isAuthorityLive()).toBe(false);
    expect(resolveAuthoritySourceTier()).not.toBe("live");
  });

  it("treats LAWMIND_OPEN_LAW_NPC as official public, not commercial live", () => {
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    expect(isAuthorityOfficialPublic()).toBe(true);
    expect(isAuthorityLive()).toBe(false);
  });

  it("official public is on by default and off only on explicit opt-out", () => {
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    expect(isAuthorityOfficialPublic()).toBe(true);
    process.env.LAWMIND_OPEN_LAW_NPC = "0";
    expect(isAuthorityOfficialPublic()).toBe(false);
    // 默认开也不等于商业 live。
    expect(isAuthorityLive()).toBe(false);
  });

  it("marks a configured vendor endpoint as live", () => {
    expect(
      resolveAuthoritySourceTier({
        provider: "pkulaw",
        endpoint: "https://legal-api.corp.example/search",
        apiKey: "k",
      }),
    ).toBe("live");
    expect(
      isAuthorityLive({
        provider: "pkulaw",
        endpoint: "https://legal-api.corp.example/search",
        apiKey: "k",
      }),
    ).toBe(true);
  });
});
