import { describe, expect, it, vi } from "vitest";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { fetchUrlDossier, mergeDossierIntoBundleParts, parseUrlList } from "./url-dossier.js";

function fetchCallUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("url-dossier", () => {
  it("parses and dedupes URL lists", () => {
    expect(parseUrlList("https://a.example\nhttps://b.example, https://a.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("blocks loopback / private endpoints via SSRF guard", async () => {
    const result = await fetchUrlDossier({
      urls: ["http://127.0.0.1:8080/secret"],
      fetchImpl: vi.fn(),
    });
    expect(result.okCount).toBe(0);
    expect(result.blockedCount).toBe(1);
    expect(result.entries[0]?.status).toBe("blocked");
  });

  it("fetches public https pages with mocked fetch and builds sources", async () => {
    const html = `<html><head><title>SAMR Notice</title></head><body><p>关于数据合规的监管提示</p></body></html>`;
    const fetchImpl = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    const result = await fetchUrlDossier({
      urls: ["https://www.samr.gov.cn/example"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.okCount).toBe(1);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.provider).toBe("url-dossier");
    expect(result.sources[0]?.citation).toMatch(/hash /);
    expect(result.entries[0]?.contentHash).toBeTruthy();
    expect(result.claims[0]?.sourceIds[0]).toBe(result.sources[0]?.id);
  });

  it("blocks firm edition when policy file is missing (fail-closed allowlist)", async () => {
    const prev = process.env.LAWMIND_EDITION;
    process.env.LAWMIND_EDITION = "firm";
    try {
      const fetchImpl = vi.fn();
      const result = await fetchUrlDossier({
        urls: ["https://www.samr.gov.cn/example"],
        workspacePolicy: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.blockedCount).toBe(1);
      expect(result.entries[0]?.error).toMatch(/networkAllowlist|允许名单|allowlist/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_EDITION;
      } else {
        process.env.LAWMIND_EDITION = prev;
      }
    }
  });

  it("follows multi-hop redirects with allowlist on each hop", async () => {
    const policy: LawMindWorkspacePolicy = {
      schemaVersion: 1,
      edition: "solo",
      networkAllowlist: ["a.example", "b.example"],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchCallUrl(input);
      if (url.includes("a.example/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://b.example/mid" },
        });
      }
      if (url.includes("b.example/mid")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://b.example/end" },
        });
      }
      return new Response("<html><body>ok page about 合规</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const result = await fetchUrlDossier({
      urls: ["https://a.example/start"],
      workspacePolicy: policy,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.okCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("re-checks network allowlist on redirect hop", async () => {
    const policy: LawMindWorkspacePolicy = {
      schemaVersion: 1,
      edition: "firm",
      networkAllowlist: ["allowed.example"],
      networkAllowlistEnforced: true,
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchCallUrl(input);
      if (url.includes("allowed.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/leak" },
        });
      }
      return new Response("should not fetch", { status: 200 });
    });
    const result = await fetchUrlDossier({
      urls: ["https://allowed.example/start"],
      workspacePolicy: policy,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.blockedCount).toBe(1);
    expect(result.entries[0]?.error).toMatch(/redirect blocked|allowlist|不在/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("merges dossier into existing bundle parts without dup ids", () => {
    const dossier = {
      entries: [],
      sources: [
        {
          id: "url-1",
          title: "A",
          kind: "web" as const,
        },
      ],
      claims: [
        {
          id: "c1",
          text: "t",
          confidence: 0.5,
          sourceIds: ["url-1"],
          model: "m",
        },
      ],
      okCount: 1,
      blockedCount: 0,
      errorCount: 0,
    };
    const merged = mergeDossierIntoBundleParts(
      {
        sources: [{ id: "url-1", title: "A", kind: "web" }],
        claims: [],
      },
      dossier,
    );
    expect(merged.sources).toHaveLength(1);
    expect(merged.claims).toHaveLength(1);
  });
});
