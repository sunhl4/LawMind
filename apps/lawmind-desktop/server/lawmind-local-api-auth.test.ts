import { describe, expect, it } from "vitest";
import {
  ensureLoopbackBearerToken,
  initLoopbackBearerFromEnv,
  isAllowedLoopbackHttpHost,
  isLawmindPackagedRuntime,
  isLoopbackApiAuthSkipped,
  validateLoopbackApiAuth,
  validateLoopbackHttpHost,
  validateLoopbackMutationContentType,
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

  describe("validateLoopbackMutationContentType (dev skip-auth CSRF 收口)", () => {
    function withSkipAuth(fn: () => void): void {
      delete process.env.LAWMIND_PACKAGED;
      process.env.LAWMIND_SKIP_API_AUTH = "1";
      try {
        fn();
      } finally {
        delete process.env.LAWMIND_SKIP_API_AUTH;
      }
    }

    function reqWith(method: string, contentType?: string): import("node:http").IncomingMessage {
      const headers: Record<string, string> = {};
      if (contentType !== undefined) {
        headers["content-type"] = contentType;
      }
      return { method, headers } as import("node:http").IncomingMessage;
    }

    it("skip-auth 下 text/plain POST（simple request CSRF 同型）被拒", () => {
      withSkipAuth(() => {
        expect(validateLoopbackMutationContentType(reqWith("POST", "text/plain"))).toBe(false);
        expect(
          validateLoopbackMutationContentType(reqWith("POST", "application/x-www-form-urlencoded")),
        ).toBe(false);
      });
    });

    it("skip-auth 下无 Content-Type 的 DELETE 被拒", () => {
      withSkipAuth(() => {
        expect(validateLoopbackMutationContentType(reqWith("DELETE"))).toBe(false);
      });
    });

    it("skip-auth 下 application/json POST 放行（本机 renderer 正路）", () => {
      withSkipAuth(() => {
        expect(validateLoopbackMutationContentType(reqWith("POST", "application/json"))).toBe(true);
        expect(
          validateLoopbackMutationContentType(
            reqWith("PUT", "application/json; charset=utf-8"),
          ),
        ).toBe(true);
      });
    });

    it("skip-auth 下 GET 等只读方法不受限", () => {
      withSkipAuth(() => {
        expect(validateLoopbackMutationContentType(reqWith("GET"))).toBe(true);
      });
    });

    it("认证开启时（非 skip-auth）不套用该检查", () => {
      delete process.env.LAWMIND_PACKAGED;
      delete process.env.LAWMIND_SKIP_API_AUTH;
      expect(validateLoopbackMutationContentType(reqWith("POST", "text/plain"))).toBe(true);
    });
  });

  describe("loopback Host 头", () => {
    it("accepts 127.0.0.1 and localhost with a port", () => {
      expect(isAllowedLoopbackHttpHost("127.0.0.1:4312")).toBe(true);
      expect(isAllowedLoopbackHttpHost("localhost:4312")).toBe(true);
      expect(isAllowedLoopbackHttpHost("[::1]:4312")).toBe(true);
    });

    it("rejects a DNS-rebind Host", () => {
      expect(isAllowedLoopbackHttpHost("evil.example")).toBe(false);
      expect(isAllowedLoopbackHttpHost("127.0.0.1.evil.example")).toBe(false);
      expect(validateLoopbackHttpHost({ headers: { host: "attacker.test" } } as import("node:http").IncomingMessage)).toBe(
        false,
      );
    });

    it("allows a missing Host outside packaged builds", () => {
      delete process.env.LAWMIND_PACKAGED;
      expect(isAllowedLoopbackHttpHost(undefined)).toBe(true);
      expect(validateLoopbackHttpHost({ headers: {} } as import("node:http").IncomingMessage)).toBe(
        true,
      );
    });

    it("requires Host in packaged builds", () => {
      process.env.LAWMIND_PACKAGED = "1";
      expect(isLawmindPackagedRuntime()).toBe(true);
      expect(isAllowedLoopbackHttpHost(undefined)).toBe(false);
      expect(isAllowedLoopbackHttpHost("127.0.0.1:9")).toBe(true);
      delete process.env.LAWMIND_PACKAGED;
    });
  });
});
