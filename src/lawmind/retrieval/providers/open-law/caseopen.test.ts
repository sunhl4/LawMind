import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CASEOPEN_SEARCH,
  resolveCaseopenEndpoint,
  searchCaseopenLive,
} from "./caseopen.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "caseopen-search.json",
);

describe("open-law/caseopen", () => {
  it("allows loopback default endpoint for self-hosted cncases", () => {
    expect(DEFAULT_CASEOPEN_SEARCH).toContain("127.0.0.1");
    const ok = resolveCaseopenEndpoint({ endpoint: DEFAULT_CASEOPEN_SEARCH });
    expect(ok.ok).toBe(true);
    expect(resolveCaseopenEndpoint({ endpoint: "ftp://x" }).ok).toBe(false);
    expect(resolveCaseopenEndpoint({ endpoint: "http://192.168.1.10/api/search" }).ok).toBe(
      false,
    );
  });

  it("fail-closed when disabled (no fetch)", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    const fetchImpl = vi.fn();
    try {
      const r = await searchCaseopenLive({
        query: "买卖",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.error).toBe("caseopen_disabled");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_OPEN_LAW_CASEOPEN = prev;
      }
    }
  });

  it("maps /api/search fixture with case source metadata", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    process.env.LAWMIND_OPEN_LAW_CASEOPEN = "1";
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain("search=");
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const r = await searchCaseopenLive({
        query: "买卖合同",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits.length).toBe(1);
      expect(r.hits[0]?.kind).toBe("case");
      expect(r.hits[0]?.title).toMatch(/买卖合同/);
      expect(r.hits[0]?.provider).toBe("open-law.caseopen");
      expect(r.hits[0]?.licenseNote).toMatch(/MPL-2\.0|caseopen/);
      expect(r.hits[0]?.demo).not.toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
      } else {
        process.env.LAWMIND_OPEN_LAW_CASEOPEN = prev;
      }
    }
  });
});
