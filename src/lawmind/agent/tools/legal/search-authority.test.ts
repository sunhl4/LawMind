import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeStatuteSearchNote, retrieveAuthorityHitsForChat } from "./search-authority.js";

const AUTH_KEYS = [
  "LAWMIND_AUTHORITY_PROVIDER",
  "LAWMIND_AUTHORITY_ENDPOINT",
  "LAWMIND_AUTHORITY_API_KEY",
  "LAWMIND_PKULAW_MODE",
  "LAWMIND_PKULAW_CASE_ENDPOINT",
  "LAWMIND_OPEN_LAW_NPC",
  "LAWMIND_OPEN_LAW_MODE",
  "LAWMIND_OPEN_LAW_CASEOPEN",
  "LAWMIND_OPEN_LAW_COURTLISTENER",
  "LAWMIND_OPEN_LAW_EURLEX",
  "LAWMIND_OPEN_LAW_EGOV_JP",
] as const;

const saved = new Map<string, string | undefined>();

function snapshotAuthEnv(): void {
  saved.clear();
  for (const key of AUTH_KEYS) {
    saved.set(key, process.env[key]);
  }
}

function restoreAuthEnv(): void {
  for (const key of AUTH_KEYS) {
    const prev = saved.get(key);
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

describe("retrieveAuthorityHitsForChat", () => {
  afterEach(() => {
    restoreAuthEnv();
  });

  it("skips commercial fetch when authority is not a live vendor", async () => {
    snapshotAuthEnv();
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_API_KEY;
    // 隔离商业源跳过意图：NPC 默认开，这里显式关闭，避免官方公开源直播调用。
    process.env.LAWMIND_OPEN_LAW_NPC = "0";
    delete process.env.LAWMIND_OPEN_LAW_MODE;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    delete process.env.LAWMIND_OPEN_LAW_EURLEX;
    delete process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    const fetchImpl = vi.fn();
    const r = await retrieveAuthorityHitsForChat({
      query: "劳动合同法",
      workspaceDir: "/tmp",
      searchKind: "law",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.live).toBe(false);
    expect(r.demoCorpus).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps pkulaw hits when provider is live", async () => {
    snapshotAuthEnv();
    process.env.LAWMIND_AUTHORITY_PROVIDER = "pkulaw";
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://authority.example/mcp-law";
    process.env.LAWMIND_AUTHORITY_API_KEY = "tok-test";
    process.env.LAWMIND_PKULAW_MODE = "rest_compat";
    const fetchImpl = vi.fn(async () =>
      Response.json({
        hits: [
          {
            id: "gid-1",
            title: "中华人民共和国劳动合同法",
            kind: "statute",
            excerpt: "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。",
            url: "https://www.pkulaw.com/chl/gid-1.html",
            provider: "pkulaw",
          },
        ],
      }),
    );
    const r = await retrieveAuthorityHitsForChat({
      query: "劳动合同法 第三十六条",
      workspaceDir: "/tmp",
      searchKind: "law",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.live).toBe(true);
    expect(r.provider).toBe("pkulaw");
    expect(r.hits[0]?.source).toBe("北大法宝");
    expect(r.hits[0]?.url).toContain("pkulaw.com");
    expect(r.hits[0]?.snippet).toContain("劳动合同法");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("queries NPC FLK by default (flag absent) as live official-public", async () => {
    snapshotAuthEnv();
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_MODE;
    const fixture = JSON.stringify({
      rows: [
        {
          title: "中华人民共和国民法典",
          bbbs: "npc-1",
          flxz: "法律",
          url: "https://flk.npc.gov.cn/detail.html?npc-1",
        },
      ],
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const r = await retrieveAuthorityHitsForChat({
      query: "一部绝对不会命中样本库的冷僻法名XYZ",
      workspaceDir: "/tmp",
      searchKind: "law",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.live).toBe(true);
    expect(r.hits[0]?.source).toBe("国家法律法规数据库");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("maps NPC FLK hits as live official-public when enabled", async () => {
    snapshotAuthEnv();
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    delete process.env.LAWMIND_OPEN_LAW_MODE;
    const fixture = JSON.stringify({
      rows: [
        {
          title: "中华人民共和国民法典",
          bbbs: "npc-1",
          flxz: "法律",
          url: "https://flk.npc.gov.cn/detail.html?npc-1",
        },
      ],
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const r = await retrieveAuthorityHitsForChat({
      query: "一部绝对不会命中样本库的冷僻法名XYZ",
      workspaceDir: "/tmp",
      searchKind: "law",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.live).toBe(true);
    expect(r.demoCorpus).toBe(false);
    expect(r.hits[0]?.source).toBe("国家法律法规数据库");
    expect(r.providerLabel).toBe("国家法律法规数据库");
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("mergeStatuteSearchNote", () => {
  it("marks live authority hits", () => {
    const v = mergeStatuteSearchNote({
      live: true,
      providerLabel: "北大法宝（闭源·手动）",
      authorityHitCount: 2,
      workspaceHitCount: 0,
      kind: "law",
    });
    expect(v.authority).toBe("live");
    expect(v.refusalRequired).toBeUndefined();
    expect(v.note).toContain("北大法宝");
  });

  it("does not call sample hits 权威库", () => {
    const v = mergeStatuteSearchNote({
      live: false,
      providerLabel: "开源语料（本地/NPC）",
      authorityHitCount: 2,
      workspaceHitCount: 0,
      kind: "law",
      demoCorpus: true,
    });
    expect(v.authority).toBe("none");
    expect(v.note).toContain("演示语料");
    expect(v.note).not.toContain("权威库");
  });

  it("refuses when live but empty", () => {
    const v = mergeStatuteSearchNote({
      live: true,
      providerLabel: "北大法宝（闭源·手动）",
      authorityHitCount: 0,
      workspaceHitCount: 0,
      kind: "law",
    });
    expect(v.refusalRequired).toBe(true);
    expect(v.note).toContain("权威库与工作区");
  });
});
