import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NPC_FLK_LIST, resolveNpcFlkEndpoint, searchNpcFlkLive } from "./npc-flk.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "npc-flk-list.json",
);

describe("open-law/npc-flk", () => {
  it("defaults to new law-search list endpoint", () => {
    expect(DEFAULT_NPC_FLK_LIST).toContain("/law-search/search/list");
    const ok = resolveNpcFlkEndpoint({ endpoint: DEFAULT_NPC_FLK_LIST });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.normalized).toBe("https://flk.npc.gov.cn/law-search/search/list");
    }
    expect(resolveNpcFlkEndpoint({ endpoint: "ftp://evil.example/x" }).ok).toBe(false);
    expect(resolveNpcFlkEndpoint({ endpoint: "https://user:pass@host.example/q" }).ok).toBe(
      false,
    );
  });

  it("fail-closed when NPC endpoint invalid (no fetch)", async () => {
    const prevFlag = process.env.LAWMIND_OPEN_LAW_NPC;
    const prevEp = process.env.LAWMIND_OPEN_LAW_NPC_ENDPOINT;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    process.env.LAWMIND_OPEN_LAW_NPC_ENDPOINT = "not-a-url";
    const fetchImpl = vi.fn();
    try {
      const r = await searchNpcFlkLive({
        query: "民法典",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits).toEqual([]);
      expect(r.error).toMatch(/npc_endpoint_invalid/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (prevFlag === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prevFlag;
      }
      if (prevEp === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC_ENDPOINT;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC_ENDPOINT = prevEp;
      }
    }
  });

  it("maps POST list fixture, strips highlight HTML, labels source metadata", async () => {
    const prevFlag = process.env.LAWMIND_OPEN_LAW_NPC;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}")) as { searchContent?: string };
      expect(body.searchContent).toBe("民法典");
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const r = await searchNpcFlkLive({
        query: "民法典",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits.length).toBeGreaterThan(0);
      expect(r.hits[0]?.title).toBe("中华人民共和国民法典");
      expect(r.hits[0]?.title).not.toMatch(/<em/);
      expect(r.hits[0]?.provider).toBe("open-law.npc_flk");
      expect(r.hits[0]?.licenseNote).toMatch(/国家法律法规数据库/);
      expect(r.hits[0]?.demo).not.toBe(true);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prevFlag;
      }
    }
  });

  it("fail-closed when endpoint returns HTML SPA shell", async () => {
    const prevFlag = process.env.LAWMIND_OPEN_LAW_NPC;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    const fetchImpl = vi.fn(async () =>
      new Response("<!doctype html><html><body>SPA</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    try {
      const r = await searchNpcFlkLive({
        query: "民法典",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.hits).toEqual([]);
      expect(r.error).toMatch(/npc_html_shell|html/i);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prevFlag;
      }
    }
  });
});
