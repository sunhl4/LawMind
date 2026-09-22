/**
 * 本机 API 凭据派生模型的回归测试。
 *
 * 这些断言锁的是**语义**，不是实现细节。改造前那套「每进程随机、只下发一次的共享
 * 令牌」有三个结构性问题，本文件逐条钉住修好之后的行为：
 *
 *   1. 重启即打断客户端  → 同一安装密钥派生出的凭据必须**跨重启逐字节相同**；
 *   2. 来源不可归属      → 不同 clientId 必须派生出不同凭据（否则又混成一个身份）；
 *   3. 无法单独吊销      → 吊销单个客户端不得影响其他客户端，也不得改密钥。
 *
 * 反向断言同样重要：轮换确实会换掉凭据、未知客户端默认拒绝 —— 若将来有人把
 * 「默认拒绝」改成「默认放行」，这些测试必须变红。
 */

import { describe, expect, it } from "vitest";
import {
  credentialForClient,
  credentialsEqual,
  deriveLocalApiCredential,
  isClientAllowedForRequest,
  LOCAL_API_CLIENTS,
  LOCAL_API_DISCOVERY_PATH,
  LOCAL_API_EPOCH_GRACE,
  resolveClientFromCredential,
} from "./local-api-credentials.mjs";

/** 固定的假安装密钥：测试不应依赖随机性（随机性只用来验「不同密钥不同结果」）。 */
const SECRET = "a".repeat(64);

describe("凭据派生：跨重启稳定是这次改造的核心", () => {
  it("同一密钥 + 同一代次 ⇒ 逐字节相同的凭据（这正是重启不再打断客户端的原因）", () => {
    // 模拟「进程 A 启动」与「进程 B 启动」：派生是纯函数，两端各算一次必须相等。
    const beforeRestart = credentialForClient(SECRET, "word-addin", 1);
    const afterRestart = credentialForClient(SECRET, "word-addin", 1);
    expect(afterRestart).toBe(beforeRestart);
    // 64 位 hex（sha256）
    expect(beforeRestart).toMatch(/^[0-9a-f]{64}$/);
  });

  it("不同 clientId ⇒ 不同凭据（否则「从哪来」又混成一个身份）", () => {
    const seen = new Map<string, string>();
    for (const clientId of LOCAL_API_CLIENTS) {
      const credential = credentialForClient(SECRET, clientId, 1);
      expect(seen.has(credential)).toBe(false);
      seen.set(credential, clientId);
    }
    expect(seen.size).toBe(LOCAL_API_CLIENTS.length);
  });

  it("不同安装密钥 ⇒ 不同凭据（所以轮换密钥 = 一次性换掉所有客户端的钥匙）", () => {
    const a = deriveLocalApiCredential(SECRET, "renderer", 1);
    const b = deriveLocalApiCredential("b".repeat(64), "renderer", 1);
    expect(a).not.toBe(b);
  });

  it("轮换代次 ⇒ 凭据随之改变", () => {
    const gen1 = credentialForClient(SECRET, "renderer", 1);
    const gen2 = credentialForClient(SECRET, "renderer", 2);
    expect(gen2).not.toBe(gen1);
  });

  it("凭据里不含密钥本身（只出现 HMAC 结果，48+ 位随机不可反推）", () => {
    const credential = deriveLocalApiCredential(SECRET, "cli", 7);
    expect(credential).not.toContain(SECRET);
    expect(credential.length).toBe(64);
  });
});

describe("常量时间比较", () => {
  it("相同即真、不同即假", () => {
    expect(credentialsEqual("abc", "abc")).toBe(true);
    expect(credentialsEqual("abc", "abd")).toBe(false);
  });

  it("长度不同直接假；空值与非字符串一律假", () => {
    expect(credentialsEqual("abc", "abcd")).toBe(false);
    expect(credentialsEqual("", "")).toBe(false);
    expect(credentialsEqual(undefined, "abc")).toBe(false);
    expect(credentialsEqual("abc", null)).toBe(false);
  });
});

describe("反查客户端：命中即认证，且能单独吊销", () => {
  it("用自己的凭据反查出正确的 clientId", () => {
    for (const clientId of LOCAL_API_CLIENTS) {
      const credential = credentialForClient(SECRET, clientId, 3);
      expect(resolveClientFromCredential(SECRET, credential, 3)).toBe(clientId);
    }
  });

  it("乱码 / 空 / 别把钥匙的凭据一律 null（不抛、不猜）", () => {
    expect(resolveClientFromCredential(SECRET, "deadbeef", 1)).toBeNull();
    expect(resolveClientFromCredential(SECRET, "", 1)).toBeNull();
    expect(resolveClientFromCredential(SECRET, credentialForClient("c".repeat(64), "renderer", 1), 1)).toBeNull();
  });

  it("缺密钥时不认证任何派生凭据（宁可拒绝，不静默降级）", () => {
    const credential = credentialForClient(SECRET, "renderer", 1);
    expect(resolveClientFromCredential("", credential, 1)).toBeNull();
  });

  it("吊销单个客户端：只挡它，其他照旧", () => {
    const revoked = credentialForClient(SECRET, "word-addin", 1);
    const kept = credentialForClient(SECRET, "renderer", 1);
    expect(resolveClientFromCredential(SECRET, revoked, 1, { revoke: ["word-addin"] })).toBeNull();
    expect(resolveClientFromCredential(SECRET, kept, 1, { revoke: ["word-addin"] })).toBe("renderer");
  });

  it("轮换后仍接受上一代（宽限窗口），但不接受更早的代次", () => {
    const previous = credentialForClient(SECRET, "renderer", 1);
    const current = credentialForClient(SECRET, "renderer", 2);
    const ancient = credentialForClient(SECRET, "renderer", 0);
    expect(resolveClientFromCredential(SECRET, current, 2)).toBe("renderer");
    // 宽限一代：在途客户端不会在轮换那一刻集体 401，可于下次发现时自愈。
    expect(resolveClientFromCredential(SECRET, previous, 2)).toBe("renderer");
    // 宽限是有界的：再老的不认（否则等于永不轮换）。
    expect(resolveClientFromCredential(SECRET, ancient, 2)).toBeNull();
    expect(LOCAL_API_EPOCH_GRACE).toBe(1);
  });

  it("宽限可显式关掉（0 = 轮换即时生效）", () => {
    const previous = credentialForClient(SECRET, "renderer", 1);
    expect(resolveClientFromCredential(SECRET, previous, 2, { grace: 0 })).toBeNull();
  });
});

describe("每客户端最小权限：默认拒绝", () => {
  it("桌面自身（desktop / renderer）全量", () => {
    for (const clientId of ["desktop", "renderer"]) {
      expect(isClientAllowedForRequest(clientId, "POST", "/api/matters/create")).toBe(true);
      expect(isClientAllowedForRequest(clientId, "GET", "/api/drafts")).toBe(true);
      expect(isClientAllowedForRequest(clientId, "DELETE", "/api/sessions/1")).toBe(true);
    }
  });

  it("word-addin 只碰插件自己的两条面（跨面即拒）", () => {
    expect(isClientAllowedForRequest("word-addin", "GET", "/api/word-addin/reviews")).toBe(true);
    expect(isClientAllowedForRequest("word-addin", "POST", "/api/word-addin/reviews")).toBe(true);
    expect(isClientAllowedForRequest("word-addin", "GET", "/word-addin/config.js")).toBe(true);
    // 插件的诉求只有「审这份 / 取结果 / 记案卷」：案卷、草稿、会话都不该碰得到。
    expect(isClientAllowedForRequest("word-addin", "POST", "/api/matters/create")).toBe(false);
    expect(isClientAllowedForRequest("word-addin", "GET", "/api/drafts")).toBe(false);
    expect(isClientAllowedForRequest("word-addin", "GET", "/api/approvals")).toBe(false);
  });

  it("cli 只读：GET/HEAD/OPTIONS 放行，写操作拒绝", () => {
    expect(isClientAllowedForRequest("cli", "GET", "/api/drafts")).toBe(true);
    expect(isClientAllowedForRequest("cli", "HEAD", "/api/drafts")).toBe(true);
    expect(isClientAllowedForRequest("cli", "POST", "/api/matters/create")).toBe(false);
    expect(isClientAllowedForRequest("cli", "DELETE", "/api/sessions/1")).toBe(false);
  });

  it("未知客户端一律拒绝（白名单是加法，不是减法）", () => {
    expect(isClientAllowedForRequest("who-knows", "GET", "/api/drafts")).toBe(false);
    expect(isClientAllowedForRequest("", "GET", "/api/health")).toBe(false);
    expect(isClientAllowedForRequest(undefined, "GET", "/api/health")).toBe(false);
  });

  it("旧式共享令牌保持改造前的全量语义（dev/E2E 覆盖路径）", () => {
    expect(isClientAllowedForRequest("shared", "POST", "/api/matters/create")).toBe(true);
  });
});

describe("发现端点路径", () => {
  it("固定在 /.well-known/lawmind-local（RFC 9728 的形状，便于将来接 OAuth）", () => {
    expect(LOCAL_API_DISCOVERY_PATH).toBe("/.well-known/lawmind-local");
  });
});
