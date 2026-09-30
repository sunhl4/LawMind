import { describe, expect, it } from "vitest";
import {
  friendlyModelErrorMessage,
  isModelProviderErrorMessage,
  surfaceModelFailureForLawyer,
} from "./model-error-message.js";

describe("friendlyModelErrorMessage", () => {
  it("maps Aliyun Arrearage JSON to billing copy", () => {
    const raw =
      'Model API error 400: {"error":{"message":"Access denied, please make sure your account is in good standing","code":"Arrearage"},"id":"chatcmpl-x","request_id":"abc"}';
    expect(friendlyModelErrorMessage(raw)).toMatch(/欠费/);
    expect(friendlyModelErrorMessage(raw)).toMatch(/充值/);
    expect(friendlyModelErrorMessage(raw)).not.toContain("chatcmpl");
    expect(friendlyModelErrorMessage(raw)).not.toContain("request_id");
  });

  it("maps generic Model API error without leaking JSON", () => {
    const raw = "Model API error 502: upstream failed";
    expect(friendlyModelErrorMessage(raw)).toMatch(/暂时不可用|异常/);
    expect(friendlyModelErrorMessage(raw)).not.toContain("502:");
  });

  it("says 没有网络 for a DNS failure instead of the syscall", () => {
    const raw =
      "Model network error: 主机「api.deepseek.com」DNS 解析失败（fail-closed）：getaddrinfo ENOTFOUND api.deepseek.com. Verify baseUrl (https://api.deepseek.com), DNS, proxy, and firewall.";
    const msg = friendlyModelErrorMessage(raw);
    expect(msg).toBe("没有网络，连不上模型。请检查本机网络后再试。");
    expect(msg).not.toMatch(/ENOTFOUND|fail-closed|baseUrl|getaddrinfo|DNS|api\.deepseek/);
  });

  it("names 欠费 or 没有网络 when the provider error has no specific cause", () => {
    const msg = friendlyModelErrorMessage("Model API error 400: something went wrong upstream");
    expect(msg).toMatch(/没有网络/);
    expect(msg).toMatch(/欠费/);
    expect(msg).not.toContain("Model API error");
  });

  it("detects provider errors", () => {
    expect(isModelProviderErrorMessage("Model API error 401: x")).toBe(true);
    expect(isModelProviderErrorMessage("session mismatch")).toBe(false);
  });
});

describe("surfaceModelFailureForLawyer", () => {
  it("rewrites a stored chat dump that still has the raw DNS error", () => {
    const stored =
      "本轮模型调用失败：Model network error: 主机「api.deepseek.com」DNS 解析失败（fail-closed）：getaddrinfo ENOTFOUND api.deepseek.com. Verify baseUrl (https://api.deepseek.com), DNS, proxy, and firewall.";
    expect(surfaceModelFailureForLawyer(stored)).toBe(
      "没有网络，连不上模型。请检查本机网络后再试。",
    );
  });

  it("leaves ordinary assistant text alone, including numbers like 429", () => {
    const memo = "请看合同第429条关于违约金的约定，以及双方是否约定了 rate limit。";
    expect(surfaceModelFailureForLawyer(memo)).toBe(memo);
  });
});
