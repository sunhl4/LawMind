/**
 * Authority endpoint validation + probe — fail-closed contract.
 * Default provider is open (local corpus); HTTP providers need explicit provider=.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorityCorpusSummary,
  probeAuthorityEndpoint,
  validateAuthorityEndpointUrl,
} from "./authority-health.js";

describe("validateAuthorityEndpointUrl", () => {
  it("accepts https endpoint and strips trailing slash", () => {
    const v = validateAuthorityEndpointUrl("https://authority.example/v1/search/");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.normalized).toBe("https://authority.example/v1/search");
      expect(v.url.host).toBe("authority.example");
    }
  });

  it("rejects empty, non-http schemes, and credentials-in-URL", () => {
    expect(validateAuthorityEndpointUrl("").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("not-a-url").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("ftp://x.example/a").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("https://user:pass@host.example/q").ok).toBe(false);
  });

  it("rejects private / link-local / metadata hosts (SSRF deny)", () => {
    expect(validateAuthorityEndpointUrl("http://127.0.0.1:8787/search").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("http://192.168.1.10/v1").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("http://169.254.169.254/latest").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("https://metadata.google.internal/").ok).toBe(false);
    expect(validateAuthorityEndpointUrl("https://localhost/api").ok).toBe(false);
    const ok = validateAuthorityEndpointUrl("https://flk.npc.gov.cn/api/");
    expect(ok.ok).toBe(true);
  });
});

describe("buildAuthorityCorpusSummary", () => {
  it("defaults to open and reports sample-ready from bundled sample", () => {
    const prev = process.env.LAWMIND_AUTHORITY_PROVIDER;
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    const prevNpc = process.env.LAWMIND_OPEN_LAW_NPC;
    const prevCase = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    try {
      const s = buildAuthorityCorpusSummary({ endpoint: "" });
      expect(s.provider).toBe("open");
      expect(s.configured).toBe(true);
      expect(s.status).toBe("sample-ready");
      expect(s.endpointHost).toMatch(/local-corpus/);
      expect(s.authConfigured).toBe(false);
      expect(s.message).toMatch(/演示语料就绪|内置 sample/);
      expect(s.message).not.toMatch(/^已配置权威检索端点/);
      expect(s.openSources?.some((x) => x.id === "local_sample" && x.ready)).toBe(true);
      expect(s.openSources?.some((x) => x.id === "npc_flk" && !x.ready)).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prev;
      }
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
      if (prevNpc === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prevNpc;
      }
      if (prevCase === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
      } else {
        process.env.LAWMIND_OPEN_LAW_CASEOPEN = prevCase;
      }
    }
  });

  it("does not mark lexis placeholder as commercially configured", () => {
    const s = buildAuthorityCorpusSummary({
      endpoint: "https://lexis.example/search",
      provider: "lexis",
      apiKey: "dummy",
    });
    expect(s.provider).toBe("lexis");
    expect(s.configured).toBe(false);
    expect(s.status).toBe("unimplemented");
    expect(s.status).not.toBe("invalid");
    expect(s.message).toMatch(/尚未实现|占位/);
  });

  it("reports unset when generic provider has empty endpoint", () => {
    const s = buildAuthorityCorpusSummary({ endpoint: "", provider: "generic" });
    expect(s.configured).toBe(false);
    expect(s.status).toBe("unset");
    expect(s.provider).toBe("generic");
    expect(s.message).toContain("LAWMIND_AUTHORITY_ENDPOINT");
  });

  it("reports unset with closed-vendor guidance for pkulaw without endpoint", () => {
    const s = buildAuthorityCorpusSummary({ endpoint: "", provider: "pkulaw" });
    expect(s.status).toBe("unset");
    expect(s.provider).toBe("pkulaw");
    expect(s.message).toMatch(/闭源|手动|open/);
  });

  it("reports invalid without treating as configured (generic)", () => {
    const s = buildAuthorityCorpusSummary({ endpoint: "ftp://bad", provider: "generic" });
    expect(s.configured).toBe(false);
    expect(s.status).toBe("invalid");
    expect(s.message).toContain("fail-closed");
  });

  it("reports configured with host only", () => {
    const s = buildAuthorityCorpusSummary({
      endpoint: "https://legal-api.corp.example/search",
      provider: "pkulaw",
    });
    expect(s.configured).toBe(true);
    expect(s.status).toBe("configured");
    expect(s.endpointHost).toBe("legal-api.corp.example");
    expect(s.authConfigured).toBe(false);
    expect(s.provider).toBe("pkulaw");
    expect(s.providerLabel).toContain("法宝");
    expect(s.message).not.toContain("user:");
    expect(s.message).toContain("LAWMIND_AUTHORITY_API_KEY");
  });

  it("reports authConfigured without exposing the key (generic)", () => {
    const s = buildAuthorityCorpusSummary({
      endpoint: "https://legal-api.corp.example/search",
      apiKey: "super-secret-token",
      provider: "generic",
    });
    expect(s.authConfigured).toBe(true);
    expect(s.message).toContain("Bearer");
    expect(JSON.stringify(s)).not.toContain("super-secret-token");
  });
});

describe("probeAuthorityEndpoint", () => {
  it("fail-closed on invalid URL without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const r = await probeAuthorityEndpoint({
      endpoint: "not-a-url",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ok when JSON has hits array (empty allowed)", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ hits: [] }));
    const r = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      apiKey: "probe-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.hitCount).toBe(0);
    expect(fetchImpl).toHaveBeenCalled();
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("__lawmind_health__");
    const init = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    expect(init.headers?.authorization).toBe("Bearer probe-key");
  });

  it("not ok on HTTP error or malformed body", async () => {
    const httpFail = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      fetchImpl: vi.fn(
        async () => new Response("nope", { status: 503 }),
      ) as unknown as typeof fetch,
    });
    expect(httpFail.ok).toBe(false);
    expect(httpFail.httpStatus).toBe(503);

    const badJson = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      fetchImpl: vi.fn(async () => Response.json({ results: [] })) as unknown as typeof fetch,
    });
    expect(badJson.ok).toBe(false);
    expect(badJson.error).toMatch(/hits\/items/);
  });

  it("uses custom timeout and reports fetch failure message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("aborted");
    });
    const r = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      timeoutMs: 50,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/aborted/);
  });

  it("ok when JSON uses items alias with hit count", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ items: [{ id: "1", title: "民法典第563条" }] }),
    );
    const r = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.hitCount).toBe(1);
  });

  it("fail-closed before fetch when DNS resolves to private IP", async () => {
    const fetchImpl = vi.fn();
    const r = await probeAuthorityEndpoint({
      endpoint: "https://authority.example/search",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => [{ address: "10.0.0.9", family: 4 }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/私网|解析到不可达/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
