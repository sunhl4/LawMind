import { describe, expect, it } from "vitest";
import {
  ensureLoopbackBearerToken,
  initLoopbackBearerFromEnv,
  isLawmindPackagedRuntime,
  isLoopbackApiAuthSkipped,
  validateLoopbackApiAuth,
} from "./lawmind-local-api-auth.js";

describe("lawmind-local-api-auth", () => {
  it("accepts bearer token when configured", () => {
    process.env.LAWMIND_SKIP_API_AUTH = "";
    process.env.LAWMIND_LOCAL_API_TOKEN = "test-token-abc";
    initLoopbackBearerFromEnv();
    const req = {
      headers: { authorization: "Bearer test-token-abc" },
    } as import("node:http").IncomingMessage;
    expect(validateLoopbackApiAuth(req)).toBe(true);
  });

  it("rejects missing authorization", () => {
    process.env.LAWMIND_SKIP_API_AUTH = "";
    process.env.LAWMIND_LOCAL_API_TOKEN = "test-token-abc";
    initLoopbackBearerFromEnv();
    const req = { headers: {} } as import("node:http").IncomingMessage;
    expect(validateLoopbackApiAuth(req)).toBe(false);
  });

  it("skips validation when LAWMIND_SKIP_API_AUTH=1 in dev", () => {
    delete process.env.LAWMIND_PACKAGED;
    process.env.LAWMIND_SKIP_API_AUTH = "1";
    const req = { headers: {} } as import("node:http").IncomingMessage;
    expect(isLoopbackApiAuthSkipped()).toBe(true);
    expect(validateLoopbackApiAuth(req)).toBe(true);
    delete process.env.LAWMIND_SKIP_API_AUTH;
  });

  it("ignores LAWMIND_SKIP_API_AUTH when LAWMIND_PACKAGED=1", () => {
    process.env.LAWMIND_PACKAGED = "1";
    process.env.LAWMIND_SKIP_API_AUTH = "1";
    process.env.LAWMIND_LOCAL_API_TOKEN = "packaged-token";
    initLoopbackBearerFromEnv();
    expect(isLawmindPackagedRuntime()).toBe(true);
    expect(isLoopbackApiAuthSkipped()).toBe(false);
    const req = { headers: {} } as import("node:http").IncomingMessage;
    expect(validateLoopbackApiAuth(req)).toBe(false);
    delete process.env.LAWMIND_PACKAGED;
    delete process.env.LAWMIND_SKIP_API_AUTH;
  });

  it("returns a stable bearer token from ensureLoopbackBearerToken", () => {
    const first = ensureLoopbackBearerToken();
    const second = ensureLoopbackBearerToken();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(8);
  });
});
