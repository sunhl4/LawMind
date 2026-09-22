import { describe, expect, it } from "vitest";
import {
  getBuildChannel,
  isCommercialBuild,
  isPlatformAuthorityProxyEnabled,
} from "./build-channel.js";

describe("build-channel", () => {
  it("defaults to oss", () => {
    expect(getBuildChannel({ channel: "" })).toBe("oss");
    expect(isCommercialBuild({ channel: "oss" })).toBe(false);
  });

  it("enables platform proxy only on commercial + flag", () => {
    expect(
      isPlatformAuthorityProxyEnabled({ channel: "oss", enableProxy: "1" }),
    ).toBe(false);
    expect(
      isPlatformAuthorityProxyEnabled({ channel: "commercial", enableProxy: "1" }),
    ).toBe(true);
    expect(
      isPlatformAuthorityProxyEnabled({ channel: "commercial", enableProxy: "0" }),
    ).toBe(false);
  });
});
