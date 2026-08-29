import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COURTLISTENER_SEARCH,
  resolveCourtListenerEndpoint,
  searchCourtListenerLive,
} from "./courtlistener.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "courtlistener-search.json",
);

describe("open-law/courtlistener", () => {
  it("defaults to official REST v4 search and rejects credentials-in-URL", () => {
    expect(DEFAULT_COURTLISTENER_SEARCH).toContain("/api/rest/v4/search");
    const ok = resolveCourtListenerEndpoint({ endpoint: DEFAULT_COURTLISTENER_SEARCH });
    expect(ok.ok).toBe(true);
    expect(resolveCourtListenerEndpoint({ endpoint: "ftp://x" }).ok).toBe(false);
    expect(
      resolveCourtListenerEndpoint({ endpoint: "https://user:pass@www.courtlistener.com/api" }).ok,
    ).toBe(false);
  });

  it("fail-closed when disabled (no fetch)", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    const fetchImpl = vi.fn();
    try {
      const r = await searchCourtListenerLive({
        query: "Miranda",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.error).toBe("courtlistener_disabled");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prev;
      }
    }
  });

  it("maps v4 search fixture with case metadata and Token header", async () => {
    const prevFlag = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    const prevToken = process.env.LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN;
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER = "1";
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN = "test-token";
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("q=Miranda");
      expect(String(url)).toContain("type=o");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Token test-token");
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const r = await searchCourtListenerLive({
        query: "Miranda",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits.length).toBe(1);
      expect(r.hits[0]?.kind).toBe("case");
      expect(r.hits[0]?.title).toMatch(/Miranda/);
      expect(r.hits[0]?.citation).toMatch(/384 U\.S\. 436/);
      expect(r.hits[0]?.url).toContain("courtlistener.com/opinion/");
      expect(r.hits[0]?.provider).toBe("open-law.courtlistener");
      expect(r.hits[0]?.licenseNote).toMatch(/CAP|CourtListener/);
      expect(r.hits[0]?.demo).not.toBe(true);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prevFlag;
      }
      if (prevToken === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN = prevToken;
      }
    }
  });

  it("surfaces 429 as rate-limit hint", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER = "1";
    const fetchImpl = vi.fn(
      async () =>
        new Response("slow down", { status: 429, headers: { "content-type": "text/plain" } }),
    );
    try {
      const r = await searchCourtListenerLive({
        query: "qualified immunity",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits).toEqual([]);
      expect(r.httpStatus).toBe(429);
      expect(r.error).toMatch(/rate_limited|COURTLISTENER_TOKEN/);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prev;
      }
    }
  });
});
