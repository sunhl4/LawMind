import { afterEach, describe, expect, it } from "vitest";
import {
  isAuthorityLive,
  resolveAuthoritySourceTier,
  WORKSPACE_HEURISTIC_SOURCE_TIER,
} from "./authority-source-tier.js";

describe("authority-source-tier", () => {
  const prev = {
    provider: process.env.LAWMIND_AUTHORITY_PROVIDER,
    endpoint: process.env.LAWMIND_AUTHORITY_ENDPOINT,
    key: process.env.LAWMIND_AUTHORITY_API_KEY,
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
  });

  it("defaults to sample and never treats workspace heuristic as live", () => {
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_API_KEY;
    expect(WORKSPACE_HEURISTIC_SOURCE_TIER).toBe("sample");
    expect(isAuthorityLive()).toBe(false);
    expect(resolveAuthoritySourceTier()).not.toBe("live");
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
