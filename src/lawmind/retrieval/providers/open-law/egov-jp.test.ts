import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EGOV_JP_KEYWORD, resolveEgovJpEndpoint, searchEgovJpLive } from "./egov-jp.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "egov-jp-keyword.json",
);

describe("open-law/egov-jp", () => {
  it("defaults to official keyword API", () => {
    expect(DEFAULT_EGOV_JP_KEYWORD).toBe("https://laws.e-gov.go.jp/api/2/keyword");
    expect(resolveEgovJpEndpoint({ endpoint: DEFAULT_EGOV_JP_KEYWORD }).ok).toBe(true);
    expect(resolveEgovJpEndpoint({ endpoint: "http://192.168.1.10/api" }).ok).toBe(false);
  });

  it("fail-closed when disabled (no fetch)", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    delete process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    const fetchImpl = vi.fn();
    try {
      const r = await searchEgovJpLive({
        query: "個人情報",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.error).toBe("egov_jp_disabled");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_OPEN_LAW_EGOV_JP = prev;
      }
    }
  });

  it("maps keyword fixture to statute hit with official URL", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    process.env.LAWMIND_OPEN_LAW_EGOV_JP = "1";
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain("keyword=");
      expect(decodeURIComponent(String(url))).toContain("個人情報");
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const r = await searchEgovJpLive({
        query: "個人情報",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits.length).toBe(1);
      expect(r.hits[0]?.kind).toBe("statute");
      expect(r.hits[0]?.title).toMatch(/個人情報/);
      expect(r.hits[0]?.url).toContain("laws.e-gov.go.jp/law/");
      expect(r.hits[0]?.provider).toBe("open-law.egov_jp");
      expect(r.hits[0]?.demo).not.toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_EGOV_JP;
      } else {
        process.env.LAWMIND_OPEN_LAW_EGOV_JP = prev;
      }
    }
  });
});
