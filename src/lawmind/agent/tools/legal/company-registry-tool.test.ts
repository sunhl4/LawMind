import { afterEach, describe, expect, it } from "vitest";
import {
  fetchCompanyRegistryLive,
  searchCompanyRegistry,
  summarizeCompanyRegistryConfig,
} from "./company-registry-tool.js";

describe("search_company_registry", () => {
  afterEach(() => {
    delete process.env.LAWMIND_COMPANY_REGISTRY_URL;
    delete process.env.LAWMIND_COMPANY_REGISTRY_KEY;
  });

  it("summarizes doctor copy without claiming live", () => {
    delete process.env.LAWMIND_COMPANY_REGISTRY_URL;
    expect(summarizeCompanyRegistryConfig().configured).toBe(false);
    expect(summarizeCompanyRegistryConfig({ url: "https://registry.example/q" }).configured).toBe(
      true,
    );
    expect(summarizeCompanyRegistryConfig({ url: "https://registry.example/q" }).message).toContain(
      "registry.example",
    );
  });

  it("honestly reports missing 工商 source", async () => {
    const prev = process.env.LAWMIND_COMPANY_REGISTRY_URL;
    delete process.env.LAWMIND_COMPANY_REGISTRY_URL;
    try {
      const result = await searchCompanyRegistry.execute(
        { name: "示例科技有限公司" },
        { workspaceDir: "/tmp/x", sessionId: "s", actorId: "a" },
      );
      expect(result.ok).toBe(true);
      const data = result.data as {
        unverified?: boolean;
        sourceTier?: string;
        authorityLive?: boolean;
      };
      expect(data.unverified).toBe(true);
      expect(data.sourceTier).toBe("sample");
      expect(data.authorityLive).toBe(false);
      expect(String((result.data as { message?: string }).message)).toContain("未接工商源");
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_COMPANY_REGISTRY_URL = prev;
      }
    }
  });

  it("does not claim live when the URL is a private host", async () => {
    const data = await fetchCompanyRegistryLive({
      endpoint: "http://127.0.0.1:9/registry",
      name: "示例科技有限公司",
    });
    expect(data.authorityLive).toBe(false);
    expect(data.unverified).toBe(true);
    expect(data.message).toMatch(/不可用|拒绝/);
  });

  it("sets authorityLive only after HTTP 2xx", async () => {
    const data = await fetchCompanyRegistryLive({
      endpoint: "https://registry.example/api",
      name: "示例科技有限公司",
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async () =>
        new Response(JSON.stringify({ name: "示例科技有限公司" }), { status: 200 }),
    });
    expect(data.authorityLive).toBe(true);
    expect(data.sourceTier).toBe("live");
    expect(data.unverified).toBe(true);
    expect(data.message).toContain("仍须对照公示原文");
  });

  it("keeps authorityLive false when the adapter errors", async () => {
    const data = await fetchCompanyRegistryLive({
      endpoint: "https://registry.example/api",
      name: "示例科技有限公司",
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    expect(data.authorityLive).toBe(false);
    expect(data.unverified).toBe(true);
    expect(data.message).toContain("HTTP 503");
  });
});
