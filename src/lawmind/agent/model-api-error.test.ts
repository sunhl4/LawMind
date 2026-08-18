import { describe, expect, it } from "vitest";
import {
  describeModelApiFailure,
  isNonRetryableModelApiError,
  ModelApiError,
  sanitizeModelApiErrorText,
} from "./model-api-error.js";

describe("model-api-error", () => {
  it("maps Aliyun arrearage JSON to a lawyer-facing account message", () => {
    const body =
      '{"error":{"message":"Access denied, please make sure your account is in good standing. For details, see: https://help.aliyun.com/zh/model-studio/error-code#overdue-payment","type":"Arrearage","code":"Arrearage"}}';
    const failure = describeModelApiFailure(400, body);
    expect(failure.code).toBe("model_account_blocked");
    expect(failure.message).toContain("欠费");
    expect(failure.message).not.toContain("aliyun");
    expect(failure.message).not.toContain("{");
  });

  it("maps unauthorized to invalid key copy", () => {
    const failure = describeModelApiFailure(401, '{"error":"Unauthorized"}');
    expect(failure.code).toBe("invalid_api_key");
    expect(failure.message).toContain("API Key");
  });

  it("scrubs leftover Model API dumps in UI text", () => {
    const dumped =
      'Model API error 400: {"error":{"message":"Access denied","code":"Arrearage","type":"Arrearage"}}';
    const cleaned = sanitizeModelApiErrorText(dumped);
    expect(cleaned).toContain("欠费");
    expect(cleaned).not.toContain("Model API error");
    expect(cleaned).not.toContain("Arrearage");
  });

  it("treats billing and key failures as non-retryable", () => {
    const blocked = new ModelApiError(describeModelApiFailure(400, '{"code":"Arrearage"}'));
    const badKey = new ModelApiError(describeModelApiFailure(401, "Unauthorized"));
    const unavailable = new ModelApiError(describeModelApiFailure(502, "bad gateway"));
    expect(isNonRetryableModelApiError(blocked)).toBe(true);
    expect(isNonRetryableModelApiError(badKey)).toBe(true);
    expect(isNonRetryableModelApiError(unavailable)).toBe(false);
  });
});
