/**
 * Connection-layer DNS-rebinding pin — security-critical rejection paths.
 * (Success path needs a live server; covered indirectly by authority-adapter tests
 *  that inject fetchImpl. Here we assert the pin re-validates at connect time.)
 */
import { describe, expect, it } from "vitest";
import { createPinnedAuthorityFetch } from "./authority-pinned-fetch.js";

describe("createPinnedAuthorityFetch — DNS rebinding pin", () => {
  it("rejects when DNS resolves to a private IP (rebinding defense, fail-closed)", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [{ address: "10.0.0.5", family: 4 }],
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(
      /解析到不可达地址|私网/,
    );
  });

  it("rejects when DNS resolves to loopback", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(
      /解析到不可达地址|loopback/,
    );
  });

  it("rejects when DNS resolves to link-local / metadata", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(
      /解析到不可达地址|link-local|元数据/,
    );
  });

  it("rejects literal loopback hostname without DNS", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    });
    await expect(pinned("https://127.0.0.1/q?q=x")).rejects.toThrow(/loopback/);
  });

  it("rejects localhost hostname", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    });
    await expect(pinned("https://localhost/q?q=x")).rejects.toThrow(/不允许/);
  });

  it("fails closed when DNS resolution throws", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(
      /DNS 解析失败.*fail-closed/,
    );
  });

  it("fails closed when DNS returns no addresses", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [],
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(
      /无解析结果.*fail-closed/,
    );
  });

  it("fails closed when every resolved address is private (no usable IP)", async () => {
    const pinned = createPinnedAuthorityFetch({
      lookup: async () => [
        { address: "10.0.0.1", family: 4 },
        { address: "172.16.0.1", family: 4 },
      ],
    });
    await expect(pinned("https://authority.example/q?q=x")).rejects.toThrow(/解析到不可达地址/);
  });
});
