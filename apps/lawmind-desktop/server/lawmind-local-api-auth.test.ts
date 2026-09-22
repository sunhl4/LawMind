import { describe, expect, it } from "vitest";
import { deriveLocalApiCredential } from "../electron/local-api-credentials.mjs";
import {
  credentialForClient,
  ensureLoopbackBearerToken,
  hasDerivedCredentials,
  initLocalApiCredentialsFromEnv,
  initLoopbackBearerFromEnv,
  isAllowedLoopbackHttpHost,
  isLawmindPackagedRuntime,
  isLoopbackApiAuthSkipped,
  resolveLoopbackClient,
  validateLoopbackApiAuth,
  validateLoopbackHttpHost,
  validateLoopbackMutationContentType,
} from "./lawmind-local-api-auth.js";

/** 测试用固定安装密钥（64 位 hex，与真实形态一致）。 */
const SECRET = "f".repeat(64);

function reqWithAuth(token?: string): import("node:http").IncomingMessage {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  return { headers } as import("node:http").IncomingMessage;
}

/**
 * 把环境变量与模块状态一起复位。
 *
 * 这个模块的状态是**进程级**的（安装密钥/代次/吊销名单），所以每条用例都必须
 * 显式设定后再 `initLocalApiCredentialsFromEnv()`，不能依赖前一条用例留下的状态。
 */
function withCredentialsEnv(
  env: {
    secret?: string;
    epoch?: string;
    revoked?: string;
    token?: string;
  },
  fn: () => void,
): void {
  const saved = {
    secret: process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET,
    epoch: process.env.LAWMIND_LOCAL_API_EPOCH,
    revoked: process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS,
    token: process.env.LAWMIND_LOCAL_API_TOKEN,
    skip: process.env.LAWMIND_SKIP_API_AUTH,
    packaged: process.env.LAWMIND_PACKAGED,
  };
  delete process.env.LAWMIND_SKIP_API_AUTH;
  delete process.env.LAWMIND_PACKAGED;
  if (env.secret === undefined) {
    delete process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET;
  } else {
    process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET = env.secret;
  }
  if (env.epoch === undefined) {
    delete process.env.LAWMIND_LOCAL_API_EPOCH;
  } else {
    process.env.LAWMIND_LOCAL_API_EPOCH = env.epoch;
  }
  if (env.revoked === undefined) {
    delete process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS;
  } else {
    process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS = env.revoked;
  }
  if (env.token === undefined) {
    delete process.env.LAWMIND_LOCAL_API_TOKEN;
  } else {
    process.env.LAWMIND_LOCAL_API_TOKEN = env.token;
  }
  initLoopbackBearerFromEnv();
  initLocalApiCredentialsFromEnv();
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries({
      LAWMIND_LOCAL_API_INSTALLATION_SECRET: saved.secret,
      LAWMIND_LOCAL_API_EPOCH: saved.epoch,
      LAWMIND_LOCAL_API_REVOKED_CLIENTS: saved.revoked,
      LAWMIND_LOCAL_API_TOKEN: saved.token,
      LAWMIND_SKIP_API_AUTH: saved.skip,
      LAWMIND_PACKAGED: saved.packaged,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

  /**
   * 派生式凭据（本次改造的核心）。
   *
   * 客户端持有的是 `HMAC(安装密钥, clientId:epoch)`；服务端按 clientId 现算比对。
   * 这里用**独立**算出的凭据喂进服务端，而不是反过来调服务端自己的签发函数 ——
   * 否则就是在用同一段逻辑验证它自己，等于没测。
   */
  describe("派生式凭据与客户端识别", () => {
    it("用某客户端的凭据能认证，且能说出是哪个客户端", () => {
      withCredentialsEnv({ secret: SECRET, epoch: "1" }, () => {
        const wordAddin = deriveLocalApiCredential(SECRET, "word-addin", 1);
        expect(validateLoopbackApiAuth(reqWithAuth(wordAddin))).toBe(true);
        expect(resolveLoopbackClient(reqWithAuth(wordAddin))).toBe("word-addin");

        const renderer = deriveLocalApiCredential(SECRET, "renderer", 1);
        expect(resolveLoopbackClient(reqWithAuth(renderer))).toBe("renderer");
      });
    });

    it("重启后同一 clientId 的凭据仍然有效（正是「窗格不再被打断」的保证）", () => {
      // 两个「进程」用同一密钥、同一代次各自初始化：凭据必须都认，且指向同一身份。
      const heldByClient = deriveLocalApiCredential(SECRET, "word-addin", 4);
      withCredentialsEnv({ secret: SECRET, epoch: "4" }, () => {
        expect(resolveLoopbackClient(reqWithAuth(heldByClient))).toBe("word-addin");
      });
      withCredentialsEnv({ secret: SECRET, epoch: "4" }, () => {
        expect(resolveLoopbackClient(reqWithAuth(heldByClient))).toBe("word-addin");
      });
    });

    it("换一把安装密钥后旧凭据立刻失效（轮换密钥 = 全部换锁）", () => {
      const oldCredential = deriveLocalApiCredential(SECRET, "renderer", 1);
      withCredentialsEnv({ secret: "e".repeat(64), epoch: "1" }, () => {
        expect(resolveLoopbackClient(reqWithAuth(oldCredential))).toBeNull();
      });
    });

    it("吊销名单能单独挡掉一个客户端，其余不受影响", () => {
      const wordAddin = deriveLocalApiCredential(SECRET, "word-addin", 1);
      const renderer = deriveLocalApiCredential(SECRET, "renderer", 1);
      withCredentialsEnv({ secret: SECRET, epoch: "1", revoked: "word-addin" }, () => {
        expect(resolveLoopbackClient(reqWithAuth(wordAddin))).toBeNull();
        expect(resolveLoopbackClient(reqWithAuth(renderer))).toBe("renderer");
      });
    });

    it("轮换后仍接受上一代（给在途客户端自愈的窗口）", () => {
      const previous = deriveLocalApiCredential(SECRET, "renderer", 1);
      withCredentialsEnv({ secret: SECRET, epoch: "2" }, () => {
        expect(resolveLoopbackClient(reqWithAuth(previous))).toBe("renderer");
      });
    });

    it("缺密钥时不认任何派生凭据（不静默降级为放行）", () => {
      const credential = deriveLocalApiCredential(SECRET, "renderer", 1);
      withCredentialsEnv({}, () => {
        expect(hasDerivedCredentials()).toBe(false);
        expect(resolveLoopbackClient(reqWithAuth(credential))).toBeNull();
      });
    });

    it("旧式共享令牌仍能认证，身份是 shared（dev/E2E 覆盖路径，语义不变）", () => {
      withCredentialsEnv({ secret: SECRET, epoch: "1", token: "legacy-token-xyz" }, () => {
        expect(resolveLoopbackClient(reqWithAuth("legacy-token-xyz"))).toBe("shared");
        // 派生凭据与共享令牌并存，互不干扰。
        expect(
          resolveLoopbackClient(reqWithAuth(deriveLocalApiCredential(SECRET, "cli", 1))),
        ).toBe("cli");
      });
    });

    it("签发给客户端的凭据与服务端认的是同一个值", () => {
      withCredentialsEnv({ secret: SECRET, epoch: "3" }, () => {
        const issued = credentialForClient("word-addin");
        expect(issued).toBe(deriveLocalApiCredential(SECRET, "word-addin", 3));
        expect(resolveLoopbackClient(reqWithAuth(issued))).toBe("word-addin");
      });
    });

    it("打包版仍强制鉴权：无凭据即 401，且不接受 skip 开关", () => {
      withCredentialsEnv({ secret: SECRET, epoch: "1" }, () => {
        process.env.LAWMIND_PACKAGED = "1";
        process.env.LAWMIND_SKIP_API_AUTH = "1";
        expect(isLoopbackApiAuthSkipped()).toBe(false);
        expect(resolveLoopbackClient(reqWithAuth())).toBeNull();
        delete process.env.LAWMIND_PACKAGED;
        delete process.env.LAWMIND_SKIP_API_AUTH;
      });
    });
  });
});
