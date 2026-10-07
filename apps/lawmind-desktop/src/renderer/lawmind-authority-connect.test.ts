import { describe, expect, it } from "vitest";
import { authorityProbeFailureText } from "./lawmind-authority-connect";

describe("authorityProbeFailureText", () => {
  it("keeps the gateway error and does not invent a success", () => {
    expect(
      authorityProbeFailureText({
        ok: false,
        probe: { ok: false, error: "权威健康检查 HTTP 401" },
      }),
    ).toBe("令牌已保存，但北大法宝没有连上。权威健康检查 HTTP 401");
  });

  it("uses a plain fallback when the body has no probe error", () => {
    expect(authorityProbeFailureText(null)).toContain("没有连上");
    expect(authorityProbeFailureText({ ok: false })).not.toContain("undefined");
  });
});
