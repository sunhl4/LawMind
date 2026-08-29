import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildEurlexSparql,
  DEFAULT_EURLEX_SPARQL,
  resolveEurlexEndpoint,
  sanitizeEurlexNeedle,
  searchEurlexLive,
} from "./eurlex.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "eurlex-sparql.json",
);

describe("open-law/eurlex", () => {
  it("defaults to CELLAR SPARQL and rejects loopback/credentials", () => {
    expect(DEFAULT_EURLEX_SPARQL).toContain("publications.europa.eu");
    expect(resolveEurlexEndpoint({ endpoint: DEFAULT_EURLEX_SPARQL }).ok).toBe(true);
    expect(resolveEurlexEndpoint({ endpoint: "http://127.0.0.1/sparql" }).ok).toBe(false);
    expect(resolveEurlexEndpoint({ endpoint: "https://user:x@host.example/q" }).ok).toBe(false);
  });

  it("sanitizes SPARQL needles so quotes cannot escape CONTAINS", () => {
    expect(sanitizeEurlexNeedle('GDPR"); DROP GRAPH <x> {')).toBe("GDPR DROP GRAPH x");
    expect(buildEurlexSparql('GDPR"); DROP')).toContain(
      'CONTAINS(LCASE(STR(?title)), LCASE("GDPR DROP"))',
    );
    expect(buildEurlexSparql("x")).toBeNull();
  });

  it("fail-closed when disabled (no fetch)", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_EURLEX;
    delete process.env.LAWMIND_OPEN_LAW_EURLEX;
    const fetchImpl = vi.fn();
    try {
      const r = await searchEurlexLive({
        query: "GDPR",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.error).toBe("eurlex_disabled");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_OPEN_LAW_EURLEX = prev;
      }
    }
  });

  it("POSTs SPARQL and maps CELEX + EUR-Lex URL", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_EURLEX;
    process.env.LAWMIND_OPEN_LAW_EURLEX = "1";
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = typeof init?.body === "string" ? init.body : "";
      expect(body).toContain("query=");
      expect(decodeURIComponent(body)).toContain("GDPR");
      expect(decodeURIComponent(body)).not.toContain('GDPR");');
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/sparql-results+json" },
      });
    });
    try {
      const r = await searchEurlexLive({
        query: "GDPR",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits.length).toBe(1);
      expect(r.hits[0]?.kind).toBe("regulation");
      expect(r.hits[0]?.citation).toMatch(/32016R0679/);
      expect(r.hits[0]?.url).toContain("CELEX:32016R0679");
      expect(r.hits[0]?.provider).toBe("open-law.eurlex");
      expect(r.hits[0]?.demo).not.toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_EURLEX;
      } else {
        process.env.LAWMIND_OPEN_LAW_EURLEX = prev;
      }
    }
  });
});
