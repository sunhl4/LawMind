import { describe, expect, it } from "vitest";
import { jsonErrorBody } from "./lawmind-api-error.js";

describe("lawmind-api-error", () => {
  it("jsonErrorBody includes code and aligned error fields", () => {
    const b = jsonErrorBody("missing_api_key", "未配置 Key");
    expect(b.ok).toBe(false);
    expect(b.code).toBe("missing_api_key");
    expect(b.message).toBe("未配置 Key");
    expect(b.error).toBe("未配置 Key");
  });
});
