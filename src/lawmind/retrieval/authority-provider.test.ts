/**
 * Authority provider resolution — OSS default is open.
 */

import { describe, expect, it } from "vitest";
import {
  authorityProviderLabel,
  authorityProviderNeedsEndpoint,
  resolveAuthorityProvider,
} from "./authority-provider.js";

describe("resolveAuthorityProvider", () => {
  it("defaults to open when unset", () => {
    const prev = process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    try {
      expect(resolveAuthorityProvider()).toBe("open");
      expect(resolveAuthorityProvider({ provider: "" })).toBe("open");
      expect(resolveAuthorityProvider({ provider: "unknown-vendor" })).toBe("open");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prev;
      }
    }
  });

  it("maps aliases", () => {
    expect(resolveAuthorityProvider({ provider: "open-law" })).toBe("open");
    expect(resolveAuthorityProvider({ provider: "npc" })).toBe("open");
    expect(resolveAuthorityProvider({ provider: "http" })).toBe("generic");
    expect(resolveAuthorityProvider({ provider: "pku" })).toBe("pkulaw");
    expect(resolveAuthorityProvider({ provider: "lexisnexis" })).toBe("lexis");
  });

  it("labels and endpoint requirements", () => {
    expect(authorityProviderNeedsEndpoint("open")).toBe(false);
    expect(authorityProviderNeedsEndpoint("generic")).toBe(true);
    expect(authorityProviderNeedsEndpoint("pkulaw")).toBe(true);
    expect(authorityProviderLabel("open")).toMatch(/开源/);
    expect(authorityProviderLabel("pkulaw")).toMatch(/闭源/);
    expect(authorityProviderLabel("lexis")).toMatch(/闭源/);
  });
});
