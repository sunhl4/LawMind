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

  it("does not treat edition ids as a commercial build", () => {
    expect(getBuildChannel({ channel: "firm" })).toBe("oss");
    expect(getBuildChannel({ channel: "private_deploy" })).toBe("oss");
    expect(getBuildChannel({ channel: "COMMERCIAL" })).toBe("commercial");
    expect(isPlatformAuthorityProxyEnabled({ channel: "solo", enableProxy: "1" })).toBe(false);
  });

  it("ignores LAWMIND_BUILD_CHANNEL writes after the process stamp", () => {
    const stamped = getBuildChannel();
    const previous = process.env.LAWMIND_BUILD_CHANNEL;
    process.env.LAWMIND_BUILD_CHANNEL = stamped === "oss" ? "commercial" : "oss";
    try {
      expect(getBuildChannel()).toBe(stamped);
    } finally {
      if (previous === undefined) {
        delete process.env.LAWMIND_BUILD_CHANNEL;
      } else {
        process.env.LAWMIND_BUILD_CHANNEL = previous;
      }
    }
  });

  it("enables platform proxy only on commercial + flag", () => {
    expect(isPlatformAuthorityProxyEnabled({ channel: "oss", enableProxy: "1" })).toBe(false);
    expect(isPlatformAuthorityProxyEnabled({ channel: "commercial", enableProxy: "1" })).toBe(true);
    expect(isPlatformAuthorityProxyEnabled({ channel: "commercial", enableProxy: "0" })).toBe(
      false,
    );
  });
});
