import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isEgressOffline, readEgressMode, resolveEgressMode } from "./workspace-policy.js";

/**
 * 出站模式是「律所级本地部署、完全不出站」的唯一接口。
 * 这里的断言锁住三件事：优先级、缺省推导、legacy 高安全模式等价。
 */
describe("resolveEgressMode", () => {
  it("defaults to open when there is no policy and no allowlist", () => {
    expect(resolveEgressMode(null)).toBe("open");
    expect(resolveEgressMode({ schemaVersion: 1 })).toBe("open");
  });

  it("derives allowlisted from a non-empty networkAllowlist", () => {
    expect(resolveEgressMode({ schemaVersion: 1, networkAllowlist: ["npc.gov.cn"] })).toBe(
      "allowlisted",
    );
  });

  it("treats an explicit egressMode as authoritative", () => {
    // 白名单非空，但显式 offline 必须赢。
    expect(
      resolveEgressMode({
        schemaVersion: 1,
        egressMode: "offline",
        networkAllowlist: ["npc.gov.cn"],
      }),
    ).toBe("offline");
    expect(
      resolveEgressMode({ schemaVersion: 1, egressMode: "open", networkAllowlist: ["x.com"] }),
    ).toBe("open");
  });

  it("keeps the deprecated highSecurityMode key equivalent to offline", () => {
    expect(resolveEgressMode({ schemaVersion: 1, highSecurityMode: true })).toBe("offline");
  });

  it("lets an explicit egressMode override the legacy key", () => {
    expect(
      resolveEgressMode({ schemaVersion: 1, highSecurityMode: true, egressMode: "allowlisted" }),
    ).toBe("allowlisted");
  });
});

describe("readEgressMode / isEgressOffline", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function writePolicy(policy: Record<string, unknown>): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-egress-"));
    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      `${JSON.stringify(policy, null, 2)}\n`,
      "utf8",
    );
    return dir;
  }

  it("reads offline from the file", () => {
    const ws = writePolicy({ schemaVersion: 1, egressMode: "offline" });
    expect(readEgressMode(ws)).toBe("offline");
    expect(isEgressOffline(ws)).toBe(true);
  });

  it("is not offline for the recommended allowlisted setup", () => {
    // 日常配置：放行官方法规站即可，不该被当成离线。
    const ws = writePolicy({
      schemaVersion: 1,
      egressMode: "allowlisted",
      allowWebSearch: true,
      networkAllowlist: ["npc.gov.cn", "court.gov.cn"],
    });
    expect(readEgressMode(ws)).toBe("allowlisted");
    expect(isEgressOffline(ws)).toBe(false);
  });
});
