import { describe, expect, it } from "vitest";
import {
  denyReasonForAuthorityHostname,
  denyReasonForAuthorityHostnameResolved,
  denyReasonForAuthorityIpAddress,
  normalizeAuthorityIpAddress,
} from "./authority-url-guard.js";

describe("denyReasonForAuthorityHostname", () => {
  it("allows public hostnames", () => {
    expect(denyReasonForAuthorityHostname("authority.example")).toBeNull();
    expect(denyReasonForAuthorityHostname("flk.npc.gov.cn")).toBeNull();
    expect(denyReasonForAuthorityHostname("api.pkulaw.com")).toBeNull();
  });

  it("denies loopback / localhost", () => {
    expect(denyReasonForAuthorityHostname("localhost")).toMatch(/不允许|loopback/);
    expect(denyReasonForAuthorityHostname("127.0.0.1")).toMatch(/loopback/);
    expect(denyReasonForAuthorityHostname("::1")).toMatch(/loopback/);
    expect(denyReasonForAuthorityHostname("foo.localhost")).toMatch(/本机|不允许/);
  });

  it("denies private IPv4 ranges", () => {
    expect(denyReasonForAuthorityHostname("10.0.0.8")).toMatch(/私网/);
    expect(denyReasonForAuthorityHostname("172.16.1.1")).toMatch(/私网/);
    expect(denyReasonForAuthorityHostname("172.31.255.255")).toMatch(/私网/);
    expect(denyReasonForAuthorityHostname("192.168.1.1")).toMatch(/私网/);
    expect(denyReasonForAuthorityHostname("100.64.1.1")).toMatch(/共享地址/);
    expect(denyReasonForAuthorityHostname("172.15.0.1")).toBeNull();
    expect(denyReasonForAuthorityHostname("172.32.0.1")).toBeNull();
  });

  it("denies link-local and cloud metadata hosts", () => {
    expect(denyReasonForAuthorityHostname("169.254.169.254")).toMatch(/link-local|元数据/);
    expect(denyReasonForAuthorityHostname("metadata.google.internal")).toMatch(/元数据|不允许/);
    expect(denyReasonForAuthorityHostname("metadata.goog")).toMatch(/元数据|不允许/);
    expect(denyReasonForAuthorityHostname("fe80::1")).toMatch(/link-local/);
  });
});

describe("denyReasonForAuthorityIpAddress / normalize", () => {
  it("strips IPv4-mapped IPv6 and denies private", () => {
    expect(normalizeAuthorityIpAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(denyReasonForAuthorityIpAddress("::ffff:10.0.0.1")).toMatch(/私网/);
    expect(denyReasonForAuthorityIpAddress("8.8.8.8")).toBeNull();
  });
});

describe("denyReasonForAuthorityHostnameResolved", () => {
  it("allows hostname that resolves only to public IPs", async () => {
    const reason = await denyReasonForAuthorityHostnameResolved("authority.example", {
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    });
    expect(reason).toBeNull();
  });

  it("denies hostname that resolves to private / loopback / link-local", async () => {
    await expect(
      denyReasonForAuthorityHostnameResolved("evil.example", {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).resolves.toMatch(/解析到不可达|loopback/);

    await expect(
      denyReasonForAuthorityHostnameResolved("evil.example", {
        lookup: async () => [{ address: "10.1.2.3", family: 4 }],
      }),
    ).resolves.toMatch(/私网/);

    await expect(
      denyReasonForAuthorityHostnameResolved("evil.example", {
        lookup: async () => [{ address: "::ffff:192.168.0.9", family: 6 }],
      }),
    ).resolves.toMatch(/私网/);

    await expect(
      denyReasonForAuthorityHostnameResolved("evil.example", {
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).resolves.toMatch(/link-local|元数据/);
  });

  it("fail-closes when DNS fails or returns empty", async () => {
    await expect(
      denyReasonForAuthorityHostnameResolved("missing.example", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).resolves.toMatch(/DNS 解析失败|fail-closed/);

    await expect(
      denyReasonForAuthorityHostnameResolved("empty.example", {
        lookup: async () => [],
      }),
    ).resolves.toMatch(/无解析结果|fail-closed/);
  });

  it("still denies literal private IPs without calling lookup", async () => {
    let called = false;
    const reason = await denyReasonForAuthorityHostnameResolved("10.0.0.1", {
      lookup: async () => {
        called = true;
        return [{ address: "8.8.8.8" }];
      },
    });
    expect(reason).toMatch(/私网/);
    expect(called).toBe(false);
  });
});
