import { describe, expect, it } from "vitest";
import { isModelProviderErrorMessage, resolveModelCallHttpError } from "./lawmind-server-helpers.js";

describe("resolveModelCallHttpError", () => {
  it("maps Model API errors to model_unavailable", () => {
    const resolved = resolveModelCallHttpError(new Error("Model API error 401: Invalid API-key"));
    expect(resolved?.code).toBe("model_unavailable");
    expect(resolved?.message).toMatch(/API Key|无效/);
    expect(resolved?.message).not.toContain("Model API error");
  });

  it("maps Aliyun Arrearage to billing copy", () => {
    const raw =
      'Model API error 400: {"error":{"message":"Access denied","code":"Arrearage"},"id":"chatcmpl-x"}';
    const resolved = resolveModelCallHttpError(new Error(raw));
    expect(resolved?.code).toBe("model_unavailable");
    expect(resolved?.message).toMatch(/欠费|账单|充值/);
    expect(resolved?.message).not.toContain("chatcmpl");
  });

  it("maps abort/timeouts to model_unavailable", () => {
    const resolved = resolveModelCallHttpError(new Error("The operation was aborted"));
    expect(resolved?.code).toBe("model_unavailable");
    expect(resolved?.status).toBe(504);
  });

  it("maps fetch failed to model_network_error", () => {
    const resolved = resolveModelCallHttpError(
      new Error("Model network error: fetch failed. Verify baseUrl (https://api.example/v1)"),
    );
    expect(resolved?.code).toBe("model_network_error");
    expect(resolved?.status).toBe(502);
  });

  it("returns null for unrelated errors", () => {
    expect(resolveModelCallHttpError(new Error("session_assistant_mismatch"))).toBeNull();
  });

  it("detects provider error messages", () => {
    expect(isModelProviderErrorMessage("Model API error 404: model not found")).toBe(true);
    expect(isModelProviderErrorMessage("no_assistant_profile")).toBe(false);
  });
});
