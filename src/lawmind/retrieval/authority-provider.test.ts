/**
 * Authority provider resolution — OSS default is open.
 */

import { describe, expect, it } from "vitest";
import {
  authorityProviderDefaultEndpoint,
  authorityProviderLabel,
  authorityProviderNeedsEndpoint,
  authorityProviderUnrecognized,
  resolveAuthorityProvider,
  resolveAuthorityProviderList,
  unknownAuthorityProviderTokens,
} from "./authority-provider.js";

describe("resolveAuthorityProvider", () => {
  it("defaults to open when unset", () => {
    const prev = process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    try {
      expect(resolveAuthorityProvider()).toBe("open");
      expect(resolveAuthorityProvider({ provider: "" })).toBe("open");
      expect(resolveAuthorityProvider({ provider: "unknown-vendor" })).toBe("open");
      expect(authorityProviderUnrecognized({ provider: "unknown-vendor" })).toBe(true);
      expect(authorityProviderUnrecognized({ provider: "" })).toBe(false);
      expect(authorityProviderUnrecognized({ provider: "open-law" })).toBe(false);
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
    expect(resolveAuthorityProvider({ provider: "yuandian" })).toBe("yuandian");
    expect(resolveAuthorityProvider({ provider: "元典" })).toBe("yuandian");
    expect(authorityProviderUnrecognized({ provider: "yuandian" })).toBe(false);
  });

  it("parses multi-vendor lists (元典 + 北大法宝同用)", () => {
    const context = (fn: () => void): void => {
      const prev = process.env.LAWMIND_AUTHORITY_PROVIDER;
      try {
        fn();
      } finally {
        if (prev === undefined) {
          delete process.env.LAWMIND_AUTHORITY_PROVIDER;
        } else {
          process.env.LAWMIND_AUTHORITY_PROVIDER = prev;
        }
      }
    };
    context(() => {
      process.env.LAWMIND_AUTHORITY_PROVIDER = "yuandian,pkulaw";
      expect(resolveAuthorityProviderList()).toEqual(["yuandian", "pkulaw"]);
      expect(unknownAuthorityProviderTokens()).toEqual([]);
      expect(resolveAuthorityProviderList()).not.toContain("open");
    });
    context(() => {
      process.env.LAWMIND_AUTHORITY_PROVIDER = "open,元典, open";
      expect(resolveAuthorityProviderList()).toEqual(["open", "yuandian"]);
    });
    context(() => {
      process.env.LAWMIND_AUTHORITY_PROVIDER = "yuandian, bogus-vendor";
      expect(resolveAuthorityProviderList()).toEqual(["yuandian"]);
      expect(unknownAuthorityProviderTokens()).toEqual(["bogus-vendor"]);
    });
    context(() => {
      process.env.LAWMIND_AUTHORITY_PROVIDER = "  bogus-only  ";
      expect(resolveAuthorityProviderList()).toEqual(["open"]);
      expect(unknownAuthorityProviderTokens()).toEqual(["bogus-only"]);
    });
  });

  it("labels and endpoint requirements", () => {
    expect(authorityProviderNeedsEndpoint("open")).toBe(false);
    expect(authorityProviderNeedsEndpoint("generic")).toBe(true);
    expect(authorityProviderNeedsEndpoint("pkulaw")).toBe(true);
    expect(authorityProviderLabel("open")).toMatch(/开源/);
    expect(authorityProviderLabel("pkulaw")).toMatch(/法宝/);
    expect(authorityProviderLabel("yuandian")).toMatch(/元典/);
    expect(authorityProviderLabel("lexis")).toMatch(/闭源/);
    expect(authorityProviderDefaultEndpoint("yuandian")).toBe("https://open.chineselaw.com/mcp");
    expect(authorityProviderDefaultEndpoint("pkulaw")).toBeUndefined();
  });
});
