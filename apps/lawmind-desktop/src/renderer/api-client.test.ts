import { describe, expect, it } from "vitest";
import { userMessageFromApiError } from "./api-client.js";

describe("api-client", () => {
  it("prefers message and appends hint for missing_api_key", () => {
    const t = userMessageFromApiError(503, {
      code: "missing_api_key",
      message: "Model API key not configured",
      error: "Model API key not configured",
    });
    expect(t).toContain("API 配置向导");
  });

  it("handles 401 with key wording", () => {
    const t = userMessageFromApiError(401, { message: "Unauthorized" });
    expect(t).toContain("API Key");
  });
});
