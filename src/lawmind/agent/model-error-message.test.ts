import { describe, expect, it } from "vitest";
import { friendlyModelErrorMessage, isModelProviderErrorMessage } from "./model-error-message.js";

describe("friendlyModelErrorMessage", () => {
  it("maps Aliyun Arrearage JSON to billing copy", () => {
    const raw =
      'Model API error 400: {"error":{"message":"Access denied, please make sure your account is in good standing","code":"Arrearage"},"id":"chatcmpl-x","request_id":"abc"}';
    expect(friendlyModelErrorMessage(raw)).toMatch(/欠费|账单|充值/);
    expect(friendlyModelErrorMessage(raw)).not.toContain("chatcmpl");
    expect(friendlyModelErrorMessage(raw)).not.toContain("request_id");
  });

  it("maps generic Model API error without leaking JSON", () => {
    const raw = "Model API error 502: upstream failed";
    expect(friendlyModelErrorMessage(raw)).toMatch(/暂时不可用|异常/);
    expect(friendlyModelErrorMessage(raw)).not.toContain("502:");
  });

  it("detects provider errors", () => {
    expect(isModelProviderErrorMessage("Model API error 401: x")).toBe(true);
    expect(isModelProviderErrorMessage("session mismatch")).toBe(false);
  });
});
