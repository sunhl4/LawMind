import { describe, expect, it } from "vitest";
import { modelServiceStatus } from "./lawmind-model-service-status";

describe("modelServiceStatus", () => {
  it("does not treat a stored key as verified", () => {
    expect(modelServiceStatus({ configured: true, verified: false })).toEqual({
      label: "待验证",
      ok: false,
    });
    expect(modelServiceStatus({ configured: true, verified: true }).label).toBe("已验证");
    expect(modelServiceStatus({ configured: false }).label).toBe("待配置");
  });
});
